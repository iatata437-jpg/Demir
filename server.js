const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const XLSX = require("xlsx");
const { VendotekClient } = require("./vendotekClient");

loadEnv();

const DEFAULT_BANK_USER = "bank-employee@demirbank.kg";
const PORT = Number(process.env.PORT || 3100);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const PROJECT_ORG = process.env.VENDOTEK_PROJECT_ORG || "bank-demir";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(24).toString("hex");
const sessions = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const delimiter = trimmed.indexOf("=");
    if (delimiter === -1) continue;
    const key = trimmed.slice(0, delimiter).trim();
    const value = trimmed.slice(delimiter + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(cookieHeader.split(";").map(cookie => {
    const delimiter = cookie.indexOf("=");
    if (delimiter === -1) return ["", ""];
    return [cookie.slice(0, delimiter).trim(), decodeURIComponent(cookie.slice(delimiter + 1).trim())];
  }).filter(([key]) => key));
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function createSession(email) {
  const id = crypto.randomUUID();
  const session = {
    id,
    email,
    createdAt: new Date().toISOString()
  };
  sessions.set(id, session);
  return session;
}

function getSession(req) {
  const token = parseCookies(req.headers.cookie || "").demir_session;
  if (!token) return null;
  const [id, signature] = token.split(".");
  if (!id || signature !== sign(id)) return null;
  return sessions.get(id) || null;
}

function publicSession(session) {
  return session ? { email: session.email } : null;
}

function isAllowedBankEmail(email) {
  const domains = String(process.env.BANK_ALLOWED_EMAIL_DOMAINS || "demirbank.kg")
    .split(",")
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  const domain = String(email || "").toLowerCase().split("@")[1] || "";
  return domains.includes(domain);
}

function createVendotekClient() {
  return new VendotekClient({
    host: process.env.VENDOTEK_HOST,
    email: process.env.VENDOTEK_EMAIL,
    password: process.env.VENDOTEK_PASSWORD,
    apiKey: process.env.VENDOTEK_API_KEY,
    autoGenerateApiKey: process.env.VENDOTEK_AUTO_GENERATE_API_KEY === "true"
  });
}

function parseDateRange(url) {
  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 7);
  const fromValue = url.searchParams.get("from") || defaultFrom.toISOString().slice(0, 10);
  const toValue = url.searchParams.get("to") || now.toISOString().slice(0, 10);
  return {
    fromValue,
    toValue,
    from: new Date(`${fromValue}T00:00:00`),
    to: new Date(`${toValue}T23:59:59`)
  };
}

function normalizeTerminal(unit, fallbackOrg) {
  return {
    orgName: unit.owned_by || unit.organization || fallbackOrg,
    unitId: String(unit.unit_id || unit.id || unit.sn || ""),
    terminalId: String(unit.tid || unit.terminal_id || ""),
    serialNumber: String(unit.sn || unit.serial_number || ""),
    name: unit.name || unit.unit_id || unit.sn || "",
    address: unit.address || unit.location || ""
  };
}

function resolveTmsClientName(org, orgName) {
  return org?.display_name || org?.name || orgName;
}

function isIpClientName(name = "") {
  const value = String(name).trim().toLowerCase();
  return value.startsWith("ip-") || value.startsWith("ип ");
}

function normalizeTransaction(raw, client, terminalsByUnit) {
  const payments = Array.isArray(raw.payment) ? raw.payment : [];
  const mainPayment = payments[0] || {};
  const cashAmount = payments.reduce((sum, payment) => sum + Number(payment.cash_amount || 0), 0);
  const cashlessAmount = payments.reduce((sum, payment) => sum + Number(payment.cashless_amount || 0), 0);
  const cashlessBody = mainPayment.cashless_body || {};
  const unitId = String(raw.unit_id || "");
  const terminal = terminalsByUnit.get(unitId) || {};
  const approved = payments.length ? payments.every(payment => payment.approved !== false) : Boolean(raw.completed);
  const cancelled = Boolean(raw.cancelled);

  return {
    vendotekId: raw.id,
    clientId: client.id,
    clientName: client.name,
    orgName: client.orgName,
    occurredAt: mainPayment.pos_localtime_at || raw.pos_localtime_at || "",
    unitId,
    terminalName: terminal.name || unitId,
    terminalId: String(raw.terminal_id || terminal.terminalId || ""),
    serialNumber: terminal.serialNumber || "",
    type: mainPayment.name || "SALE",
    status: cancelled ? "cancelled" : (approved && raw.completed ? "approved" : (approved ? "pending" : "declined")),
    amount: cashAmount + cashlessAmount,
    cashAmount,
    cashlessAmount,
    rrn: cashlessBody.rrn || "",
    invoice: cashlessBody.invoice || "",
    authId: cashlessBody.auth_id || "",
    pan: cashlessBody.pan || "",
    issuer: cashlessBody.issuer || cashlessBody.host_name || "",
    responseCode: cashlessBody.response_code || ""
  };
}

async function loadProjectClients() {
  const api = createVendotekClient();
  const env = await api.fetchEnv();
  const allowedOrgs = new Set(Array.isArray(env?.distributees) ? env.distributees : []);
  const organizations = await api.fetchOrganizations();
  const projectOrg = organizations.find(org =>
    org.name === PROJECT_ORG ||
    String(org.display_name || "").toLowerCase() === PROJECT_ORG.toLowerCase()
  );
  if (!projectOrg) {
    const error = new Error(`Проект ${PROJECT_ORG} не найден в TMS`);
    error.statusCode = 404;
    throw error;
  }

  const tmsOrganizations = organizations
    .filter(org => org.name && (!allowedOrgs.size || allowedOrgs.has(org.name)))
    .filter(org => org.distributor === projectOrg.name)
    .filter(org => isIpClientName(resolveTmsClientName(org, org.name)))
    .sort((a, b) => resolveTmsClientName(a, a.name).localeCompare(resolveTmsClientName(b, b.name), "ru"));

  const clients = tmsOrganizations.map(org => ({
    id: org.name,
    orgName: org.name,
    name: resolveTmsClientName(org, org.name),
    projectName: resolveTmsClientName(projectOrg, PROJECT_ORG),
    terminals: []
  }));

  const queue = [...clients];
  const workerCount = Math.min(8, queue.length);
  async function runWorker() {
    while (queue.length) {
      const client = queue.shift();
      try {
        const units = await api.fetchUnits(client.orgName);
        client.terminals = (Array.isArray(units) ? units : []).map(unit => normalizeTerminal(unit, client.orgName));
      } catch (error) {
        client.terminals = [];
        client.error = error.message;
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return clients;
}

function buildClientsWorkbook(clients) {
  const workbook = XLSX.utils.book_new();
  const rows = clients.map(client => ({
    "Наименование TMS": client.name,
    "TMS": client.orgName,
    "Проект": client.projectName,
    "Терминалов": client.terminals.length
  }));
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Clients");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

async function loadProjectClient(clientId) {
  const clients = await loadProjectClients();
  const client = clients.find(item => item.id === clientId || item.orgName === clientId);
  if (!client) {
    const error = new Error("Клиент не найден в проекте bank-demir");
    error.statusCode = 404;
    throw error;
  }
  return client;
}

async function loadClientTransactions(client, range) {
  const api = createVendotekClient();
  const terminalsByUnit = new Map((client.terminals || []).map(terminal => [terminal.unitId, terminal]));
  const byId = new Map();
  let minId = 0;
  let restarted = true;

  for (let page = 0; page < 30; page += 1) {
    const payload = await api.fetchVends(client.orgName, { minId, restarted });
    const items = Array.isArray(payload?.items) ? payload.items : [];
    for (const item of items) {
      const transaction = normalizeTransaction(item, client, terminalsByUnit);
      const time = Date.parse(transaction.occurredAt || "");
      if (
        Number(transaction.cashlessAmount || 0) > 0 &&
        Number.isFinite(time) &&
        time >= range.from.getTime() &&
        time <= range.to.getTime()
      ) {
        byId.set(String(transaction.vendotekId), transaction);
      }
    }
    if (payload?.next_id == null) break;
    minId = Number(payload.next_id);
    restarted = false;
  }

  return Array.from(byId.values()).sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
}

async function loadClientTsoReport(client, range) {
  const api = createVendotekClient();
  const tso = await api.fetchTsoReport(client.orgName, range.fromValue, range.toValue);
  const units = (Array.isArray(tso?.units) ? tso.units : [])
    .filter(row => Number(row.approved_cashless_count || 0) > 0 || Number(row.approved_cashless_amount || 0) > 0);
  const total = summarizeTso(units, []);
  return {
    project: PROJECT_ORG,
    type: "TSO",
    typeName: "Итоговый отчет по организации: безнал",
    period: { from: range.fromValue, to: range.toValue },
    client,
    units,
    total: [total],
    totals: total
  };
}

function summarizeTso(units, total) {
  const source = total.length ? total : units;
  return source.reduce((acc, row) => {
    acc.sales += Number(row.approved_count || 0);
    acc.cashlessSales += Number(row.approved_cashless_count || 0);
    acc.cashless += Number(row.approved_cashless_amount || 0);
    acc.amount += Number(row.approved_cashless_amount || 0);
    acc.connectionErrors += Number(row.errored_count || 0);
    acc.otherErrors += Number(row.declined_count || 0);
    return acc;
  }, {
    sales: 0,
    cashlessSales: 0,
    cashless: 0,
    amount: 0,
    connectionErrors: 0,
    otherErrors: 0
  });
}

async function loadClientTsoCsv(client, range) {
  const api = createVendotekClient();
  return api.fetchTsoReportCsv(client.orgName, range.fromValue, range.toValue);
}

function buildReport(clients, transactions, range) {
  const byClient = clients.map(client => {
    const clientTransactions = transactions.filter(item => item.clientId === client.id);
    return {
      client,
      count: clientTransactions.length,
      approved: clientTransactions.filter(item => item.status === "approved").length,
      cancelled: clientTransactions.filter(item => item.status === "cancelled").length,
      declined: clientTransactions.filter(item => item.status === "declined").length,
      cashlessAmount: clientTransactions.reduce((sum, item) => sum + Number(item.cashlessAmount || 0), 0)
    };
  });

  return {
    project: PROJECT_ORG,
    period: { from: range.fromValue, to: range.toValue },
    totals: {
      clients: clients.length,
      transactions: transactions.length,
      approved: transactions.filter(item => item.status === "approved").length,
      cancelled: transactions.filter(item => item.status === "cancelled").length,
      declined: transactions.filter(item => item.status === "declined").length,
      cashlessAmount: transactions.reduce((sum, item) => sum + Number(item.cashlessAmount || 0), 0)
    },
    byClient,
    transactions
  };
}

function buildWorkbook(report) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.byClient.map(row => ({
    "Клиент": row.client.name,
    "TMS": row.client.orgName,
    "Терминалов": row.client.terminals.length,
    "Операций": row.count,
    "Успешных": row.approved,
    "Отмен": row.cancelled,
    "Отклонено": row.declined,
    "Безнал": row.cashlessAmount
  }))), "Summary");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(report.transactions.map(item => ({
    "Клиент": item.clientName,
    "TMS": item.orgName,
    "Дата": item.occurredAt,
    "Терминал": item.terminalName,
    "Серийный номер": item.serialNumber,
    "Terminal ID": item.terminalId,
    "Тип": item.type,
    "Статус": item.status,
    "Безнал": item.cashlessAmount,
    "RRN": item.rrn,
    "Invoice": item.invoice,
    "Auth ID": item.authId,
    "Карта/банк": item.pan || item.issuer,
    "Response code": item.responseCode
  }))), "Transactions");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function buildTsoWorkbook(report) {
  const workbook = XLSX.utils.book_new();
  const summaryRows = [{
    "Клиент": report.client.name,
    "TMS": report.client.orgName,
    "Тип отчета": "TSO",
    "Период с": report.period.from,
    "Период по": report.period.to,
    "Безнал операций": report.totals.cashlessSales,
    "Безнал": report.totals.cashless,
    "Ошибки связи": report.totals.connectionErrors,
    "Другие ошибки": report.totals.otherErrors
  }];
  const unitRows = report.units.map(row => ({
    "Unit ID": row.unit_id || "",
    "Terminal ID": row.terminal_id || "",
    "Location": row.location || "",
    "Currency": row.currency || "",
    "Cashless Count": Number(row.approved_cashless_count || 0),
    "Cashless Amount": Number(row.approved_cashless_amount || 0),
    "Connection Errors": Number(row.errored_count || 0),
    "Other Errors": Number(row.declined_count || 0),
    "Voided Count": Number(row.voided_count || 0),
    "Voided Amount": Number(row.voided_amount || 0),
    "Rejected Count": Number(row.rejected_count || 0),
    "Rejected Amount": Number(row.rejected_amount || 0)
  }));
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), "Summary");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(unitRows), "TSO");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

async function generateReport(range) {
  const clients = await loadProjectClients();
  const transactionGroups = [];
  for (const client of clients) {
    transactionGroups.push(await loadClientTransactions(client, range));
  }
  return buildReport(clients, transactionGroups.flat(), range);
}

async function handleLogin(req, res) {
  const body = await collectBody(req);
  const email = String(body.email || DEFAULT_BANK_USER).trim().toLowerCase();
  if (email && !isAllowedBankEmail(email)) {
    return sendJson(res, 403, { message: "Доступ разрешен только сотрудникам банка" });
  }
  const session = createSession(email || DEFAULT_BANK_USER);
  const token = `${session.id}.${sign(session.id)}`;
  return sendJson(res, 200, { user: publicSession(session) }, {
    "Set-Cookie": `demir_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`
  });
}

function logout(req, res) {
  const token = parseCookies(req.headers.cookie || "").demir_session;
  const id = token?.split(".")[0];
  if (id) sessions.delete(id);
  return sendJson(res, 200, { ok: true }, {
    "Set-Cookie": "demir_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
  });
}

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/login") return handleLogin(req, res);
  if (req.method === "POST" && url.pathname === "/api/logout") return logout(req, res);

  const session = getSession(req) || createSession(DEFAULT_BANK_USER);
  if (req.method === "GET" && url.pathname === "/api/me") {
    return sendJson(res, 200, { user: publicSession(session) });
  }

  if (req.method === "GET" && url.pathname === "/api/report") {
    const report = await generateReport(parseDateRange(url));
    if (url.searchParams.get("format") === "xlsx") {
      const buffer = buildWorkbook(report);
      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="demir-cashless-${report.period.from}-${report.period.to}.xlsx"`,
        "Cache-Control": "no-store"
      });
      return res.end(buffer);
    }
    return sendJson(res, 200, report);
  }

  const clientReportMatch = url.pathname.match(/^\/api\/clients\/([^/]+)\/report$/);
  if (req.method === "GET" && clientReportMatch) {
    const range = parseDateRange(url);
    const client = await loadProjectClient(decodeURIComponent(clientReportMatch[1]));
    if (url.searchParams.get("format") === "csv") {
      const csv = await loadClientTsoCsv(client, range);
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="TSO_${client.orgName}_${range.fromValue}_${range.toValue}.csv"`,
        "Cache-Control": "no-store"
      });
      return res.end(csv);
    }
    const report = await loadClientTsoReport(client, range);
    if (url.searchParams.get("format") === "xlsx") {
      const buffer = buildTsoWorkbook(report);
      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="TSO_${client.orgName}_${range.fromValue}_${range.toValue}.xlsx"`,
        "Cache-Control": "no-store"
      });
      return res.end(buffer);
    }
    return sendJson(res, 200, report);
  }

  if (req.method === "GET" && url.pathname === "/api/clients") {
    const clients = await loadProjectClients();
    if (url.searchParams.get("format") === "xlsx") {
      const buffer = buildClientsWorkbook(clients);
      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="demir-bank-tms-clients.xlsx"`,
        "Cache-Control": "no-store"
      });
      return res.end(buffer);
    }
    return sendJson(res, 200, {
      project: PROJECT_ORG,
      clients
    });
  }

  return sendJson(res, 404, { message: "API route not found" });
}

function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Файл не найден");
    }
    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { message: error.message || "Ошибка сервера" });
  }
});

server.listen(PORT, () => {
  console.log(`Demir cashless reports: http://localhost:${PORT}`);
});
