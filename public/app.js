let currentUser = null;
let currentReport = null;
let currentClients = [];
let activeClient = null;
let summaryRefreshTimer = null;
let summaryAutoRefreshTimer = null;
let summaryRequestId = 0;

const formatMoney = value => `${Number(value || 0).toLocaleString("ru-RU")} сом`;
const formatDate = value => value ? new Date(value).toLocaleString("ru-RU") : "-";
const formatDateOnly = date => {
  const value = new Date(date);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 10);
};

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || "Ошибка запроса");
  return payload;
}

function setDefaultDates() {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 7);
  if (!document.querySelector("#fromDate").value) document.querySelector("#fromDate").value = formatDateOnly(from);
  if (!document.querySelector("#toDate").value) document.querySelector("#toDate").value = formatDateOnly(now);
}

function showApp(user) {
  currentUser = user;
  document.querySelector("#loginScreen").classList.add("hidden");
  document.querySelector("#app").classList.remove("hidden");
  document.querySelector("#userEmail").textContent = user.email;
  setDefaultDates();
  startSummaryAutoRefresh();
  loadClients();
}

function showLogin() {
  currentUser = null;
  document.querySelector("#loginScreen").classList.remove("hidden");
  document.querySelector("#app").classList.add("hidden");
}

async function bootstrap() {
  try {
    const payload = await requestJson("/api/me");
    if (payload.user) showApp(payload.user);
    else showLogin();
  } catch {
    showLogin();
  }
}

async function login(event) {
  event.preventDefault();
  const message = document.querySelector("#loginMessage");
  message.textContent = "";
  message.classList.remove("error");
  try {
    const payload = await requestJson("/api/login", {
      method: "POST",
      body: JSON.stringify({
        email: document.querySelector("#email").value,
        password: document.querySelector("#password").value
      })
    });
    showApp(payload.user);
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  }
}

async function logout() {
  await requestJson("/api/logout", { method: "POST" });
  currentReport = null;
  currentClients = [];
  activeClient = null;
  clearInterval(summaryAutoRefreshTimer);
  showLogin();
}

function reportParams() {
  setDefaultDates();
  return new URLSearchParams({
    from: document.querySelector("#fromDate").value,
    to: document.querySelector("#toDate").value
  });
}

function summaryParams() {
  const today = formatDateOnly(new Date());
  const fromInput = document.querySelector("#summaryFromDate");
  const toInput = document.querySelector("#summaryToDate");
  const from = fromInput.value || toInput.value || today;
  const to = toInput.value || fromInput.value || today;
  return new URLSearchParams({ from, to });
}

function setSummaryLiveState(text, state = "") {
  const total = document.querySelector("#summaryLiveTotal");
  total.textContent = text;
  total.classList.toggle("loading", state === "loading");
  total.classList.toggle("error", state === "error");
}

function getReportTerminalCount(report) {
  if (report?.client) return Number(report.client.terminals?.length || 0);
  return (report?.byClient || []).reduce((sum, row) => sum + Number(row.client?.terminals?.length || 0), 0);
}

function renderSummaryReport(report) {
  const totals = report?.totals || {};
  const clientCount = Number(totals.clients || 0);
  const terminalCount = getReportTerminalCount(report);
  const operationCount = Number(totals.transactions || 0);
  const successfulCount = Number(totals.approved || 0);
  const cashlessAmount = Number(totals.cashlessAmount || 0);
  currentReport = report;
  if (!activeClient) currentClients = report.byClient.map(row => row.client);
  document.querySelector("#metrics").innerHTML = `
    <article class="metric"><span>Клиенты</span><strong>${clientCount}</strong></article>
    <article class="metric"><span>Терминалы Demir</span><strong>${terminalCount}</strong></article>
    <article class="metric"><span>Безнал операции</span><strong>${operationCount}</strong></article>
    <article class="metric"><span>Успешные</span><strong class="ok">${successfulCount}</strong></article>
    <article class="metric"><span>Безнал</span><strong>${formatMoney(cashlessAmount)}</strong></article>
  `;
  renderClients();
}

function buildSummaryReportFromTso(report) {
  const byClient = (report.reports || []).map(item => ({
    client: item.client,
    count: Number(item.totals?.cashlessSales || 0),
    approved: Number(item.totals?.cashlessSales || 0),
    cashlessAmount: Number(item.totals?.cashless || 0)
  }));
  return {
    period: report.period,
    totals: {
      clients: byClient.length,
      transactions: Number(report.totals?.cashlessSales || 0),
      approved: Number(report.totals?.cashlessSales || 0),
      cashlessAmount: Number(report.totals?.cashless || 0)
    },
    byClient
  };
}

function buildSummaryReportFromClientTso(report) {
  return {
    period: report.period,
    client: report.client,
    totals: {
      clients: 1,
      transactions: Number(report.totals?.cashlessSales || 0),
      approved: Number(report.totals?.cashlessSales || 0),
      cashlessAmount: Number(report.totals?.cashless || 0)
    },
    byClient: [{
      client: report.client,
      count: Number(report.totals?.cashlessSales || 0),
      approved: Number(report.totals?.cashlessSales || 0),
      cashlessAmount: Number(report.totals?.cashless || 0)
    }]
  };
}

async function refreshClientSummary({ silent = false } = {}) {
  const requestId = ++summaryRequestId;
  const params = summaryParams();
  const from = params.get("from");
  const to = params.get("to");
  const selectedClient = activeClient;
  if (!silent) setSummaryLiveState("Считаем...", "loading");
  try {
    const url = selectedClient
      ? `/api/clients/${encodeURIComponent(selectedClient.orgName)}/report?${params.toString()}`
      : `/api/tso-report?${params.toString()}`;
    const tsoReport = await requestJson(url);
    if (requestId !== summaryRequestId) return;
    if (selectedClient && activeClient?.orgName !== selectedClient.orgName) return;
    const report = selectedClient
      ? buildSummaryReportFromClientTso(tsoReport)
      : buildSummaryReportFromTso(tsoReport);
    if (!selectedClient) document.querySelector("#clientDetail").classList.add("hidden");
    renderSummaryReport(report);
    if (selectedClient) renderTsoRows(tsoReport.units || []);
    setSummaryLiveState(`Безнал: ${formatMoney(report.totals.cashlessAmount || 0)}`);
    document.querySelector("#status").textContent = selectedClient
      ? `Онлайн-сводка по ${selectedClient.name} за период ${from} - ${to} обновлена.`
      : `Онлайн-сводка по всем клиентам за период ${from} - ${to} обновлена.`;
    document.querySelector("#status").classList.remove("error");
  } catch (error) {
    if (requestId !== summaryRequestId) return;
    setSummaryLiveState("Ошибка расчета", "error");
    document.querySelector("#status").textContent = error.message;
    document.querySelector("#status").classList.add("error");
  }
}

function scheduleClientSummaryRefresh() {
  clearTimeout(summaryRefreshTimer);
  summaryRefreshTimer = setTimeout(() => refreshClientSummary(), 350);
}

function startSummaryAutoRefresh() {
  clearInterval(summaryAutoRefreshTimer);
  summaryAutoRefreshTimer = setInterval(() => {
    if (!document.querySelector("#app").classList.contains("hidden")) {
      refreshClientSummary({ silent: true });
    }
  }, 60000);
}

async function buildReport() {
  const status = document.querySelector("#status");
  status.textContent = "Загружаем данные из Vendotek/TMS...";
  status.classList.remove("error");
  try {
    currentReport = await requestJson(`/api/report?${reportParams().toString()}`);
    currentClients = currentReport.byClient.map(row => row.client);
    renderReport();
    status.textContent = `Отчет сформирован за период ${currentReport.period.from} - ${currentReport.period.to}.`;
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
  }
}

function exportReport() {
  const params = reportParams();
  params.set("format", "xlsx");
  window.location.href = `/api/report?${params.toString()}`;
}

function exportAllTso() {
  const params = reportParams();
  params.set("format", "xlsx");
  window.location.href = `/api/tso-report?${params.toString()}`;
}

async function loadClients() {
  const status = document.querySelector("#status");
  status.textContent = "Загружаем клиентов проекта bank-demir из TMS...";
  status.classList.remove("error");
  try {
    const payload = await requestJson("/api/clients");
    currentClients = payload.clients || [];
    currentReport = null;
    activeClient = null;
    document.querySelector("#clientDetail").classList.add("hidden");
    renderClientCards();
    renderClients();
    const terminalTotal = currentClients.reduce((sum, client) => sum + Number(client.terminals?.length || 0), 0);
    document.querySelector("#metrics").innerHTML = `
      <article class="metric"><span>Проект</span><strong>${escapeHtml(payload.project || "bank-demir")}</strong></article>
      <article class="metric"><span>Клиенты TMS</span><strong>${currentClients.length}</strong></article>
      <article class="metric"><span>Терминалов Demir</span><strong>${terminalTotal}</strong></article>
    `;
    document.querySelector("#transactionsTable").innerHTML = `<tr><td colspan="7" class="muted">Сначала сформируйте отчет по периоду, чтобы увидеть транзакции</td></tr>`;
    status.textContent = "Клиенты загружены. Наименования взяты из TMS.";
    refreshClientSummary({ silent: true });
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
  }
}

function exportClients() {
  window.location.href = "/api/clients?format=xlsx";
}

function openClientCard(clientId) {
  activeClient = currentClients.find(client => client.id === clientId || client.orgName === clientId);
  if (!activeClient) return;
  currentReport = null;
  document.querySelector("#clientDetail").classList.remove("hidden");
  document.querySelector("#clientTitle").textContent = activeClient.name;
  document.querySelector("#clientMeta").textContent = `${activeClient.orgName}: ${activeClient.terminals.length} терминал(ов)`;
  document.querySelector("#status").textContent = "Выберите период и запросите отчет по выбранному клиенту.";
  document.querySelector("#metrics").innerHTML = `
    <article class="metric"><span>Наименование TMS</span><strong>${escapeHtml(activeClient.name)}</strong></article>
    <article class="metric"><span>TMS</span><strong>${escapeHtml(activeClient.orgName)}</strong></article>
    <article class="metric"><span>Терминалы</span><strong>${activeClient.terminals.length}</strong></article>
  `;
  document.querySelector("#clientsTable").innerHTML = `
    <tr>
      <td>${escapeHtml(activeClient.name)}</td>
      <td>${escapeHtml(activeClient.orgName)}</td>
      <td>${Number(activeClient.terminals.length || 0)}</td>
      <td>0</td>
      <td>0</td>
      <td>${formatMoney(0)}</td>
    </tr>
  `;
  document.querySelector("#transactionsTable").innerHTML = `<tr><td colspan="7" class="muted">Отчет по этой карточке еще не запрошен</td></tr>`;
  refreshClientSummary();
}

function closeClientCard() {
  activeClient = null;
  currentReport = null;
  document.querySelector("#clientDetail").classList.add("hidden");
  document.querySelector("#status").textContent = "Выберите карточку ИП или сформируйте общий отчет.";
  renderClients();
  document.querySelector("#transactionsTable").innerHTML = `<tr><td colspan="7" class="muted">Нет данных</td></tr>`;
  refreshClientSummary();
}

async function buildClientReport() {
  if (!activeClient) return;
  const status = document.querySelector("#status");
  status.textContent = `Запрашиваем отчет по ${activeClient.name}...`;
  status.classList.remove("error");
  try {
    currentReport = await requestJson(`/api/clients/${encodeURIComponent(activeClient.orgName)}/report?${reportParams().toString()}`);
    renderReport();
    status.textContent = `Отчет по ${activeClient.name} сформирован за период ${currentReport.period.from} - ${currentReport.period.to}.`;
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
  }
}

function exportClientReport() {
  if (!activeClient) return;
  const params = reportParams();
  params.set("format", "csv");
  window.location.href = `/api/clients/${encodeURIComponent(activeClient.orgName)}/report?${params.toString()}`;
}

function exportClientExcel() {
  if (!activeClient) return;
  const params = reportParams();
  params.set("format", "xlsx");
  window.location.href = `/api/clients/${encodeURIComponent(activeClient.orgName)}/report?${params.toString()}`;
}

function renderReport() {
  const totals = currentReport?.totals || {};
  const clientCount = currentReport?.client ? 1 : Number(totals.clients || 0);
  const terminalCount = getReportTerminalCount(currentReport);
  const operationCount = Number(totals.cashlessSales || totals.transactions || 0);
  const successfulCount = Number(totals.cashlessSales || totals.approved || 0);
  const cashlessAmount = Number(totals.cashless || totals.cashlessAmount || 0);
  document.querySelector("#metrics").innerHTML = `
    <article class="metric"><span>Клиенты</span><strong>${clientCount}</strong></article>
    <article class="metric"><span>Терминалы Demir</span><strong>${terminalCount}</strong></article>
    <article class="metric"><span>Безнал операции</span><strong>${operationCount}</strong></article>
    <article class="metric"><span>Успешные</span><strong class="ok">${successfulCount}</strong></article>
    <article class="metric"><span>Безнал</span><strong>${formatMoney(cashlessAmount)}</strong></article>
  `;
  renderClients();
  renderTransactions();
}

function renderClientCards() {
  const query = document.querySelector("#cardSearch").value.trim().toLowerCase();
  const rows = currentClients.filter(client => {
    const haystack = `${client.name} ${client.orgName}`.toLowerCase();
    return !query || haystack.includes(query);
  });
  document.querySelector("#clientCards").innerHTML = rows.length ? rows.map(client => `
    <button type="button" class="client-card" data-client-id="${escapeHtml(client.id)}">
      <strong>${escapeHtml(client.name)}</strong>
      <span>TMS: ${escapeHtml(client.orgName)}</span>
      <span class="count">${Number(client.terminals.length || 0)} терминал(ов)</span>
    </button>
  `).join("") : `<p class="muted">Карточки ИП не найдены</p>`;
}

function renderClients() {
  const query = document.querySelector("#search").value.trim().toLowerCase();
  const reportRows = currentReport?.client
    ? [{
      client: currentReport.client,
      count: currentReport.totals?.cashlessSales || currentReport.totals?.transactions || 0,
      approved: currentReport.totals?.cashlessSales || currentReport.totals?.approved || 0,
      cashlessAmount: currentReport.totals?.cashless || currentReport.totals?.cashlessAmount || 0
    }]
    : (currentReport?.byClient || currentClients.map(client => ({
      client,
      count: 0,
      approved: 0,
      cashlessAmount: 0
    })));
  const rows = reportRows.filter(row => {
    const haystack = `${row.client.name} ${row.client.orgName}`.toLowerCase();
    return !query || haystack.includes(query);
  });
  document.querySelector("#clientsTable").innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td>${escapeHtml(row.client.name)}</td>
      <td>${escapeHtml(row.client.orgName)}</td>
      <td>${Number(row.client.terminals.length || 0)}</td>
      <td>${Number(row.count || 0)}</td>
      <td>${Number(row.approved || 0)}</td>
      <td>${formatMoney(row.cashlessAmount || 0)}</td>
    </tr>
  `).join("") : `<tr><td colspan="6" class="muted">Нет данных</td></tr>`;
}

function renderTransactions() {
  if (currentReport?.type === "TSO") {
    renderTsoRows(currentReport.units || []);
    return;
  }
  const rows = currentReport?.transactions || [];
  document.querySelector("#transactionsTable").innerHTML = rows.length ? rows.map(item => `
    <tr>
      <td>${formatDate(item.occurredAt)}</td>
      <td>${escapeHtml(item.clientName)}</td>
      <td>
        ${escapeHtml(item.terminalName || item.unitId)}
        <div class="muted">${escapeHtml([item.serialNumber, item.terminalId].filter(Boolean).join(" / "))}</div>
      </td>
      <td>${escapeHtml(item.type)}</td>
      <td>${escapeHtml(item.status)}</td>
      <td>${formatMoney(item.cashlessAmount)}</td>
      <td>${escapeHtml([item.rrn, item.invoice, item.authId].filter(Boolean).join(" / ") || "-")}</td>
    </tr>
  `).join("") : `<tr><td colspan="7" class="muted">Нет безналичных операций за выбранный период</td></tr>`;
}

function renderTsoRows(rows) {
  document.querySelector("#transactionsTable").innerHTML = rows.length ? rows.map(item => `
    <tr>
      <td>${escapeHtml(item.unit_id || "-")}</td>
      <td>${escapeHtml(item.terminal_id || "-")}</td>
      <td>${escapeHtml(item.location || "-")}</td>
      <td>${Number(item.approved_cashless_count || 0)}</td>
      <td>${formatMoney(item.approved_cashless_amount || 0)}</td>
      <td>${Number(item.errored_count || 0) + Number(item.declined_count || 0)}</td>
    </tr>
  `).join("") : `<tr><td colspan="7" class="muted">По TSO нет данных за выбранный период</td></tr>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.querySelector("#loginForm").addEventListener("submit", login);
document.querySelector("#logoutButton").addEventListener("click", logout);
const buildReportButton = document.querySelector("#buildReport");
if (buildReportButton) buildReportButton.addEventListener("click", buildReport);
document.querySelector("#exportReport").addEventListener("click", exportReport);
document.querySelector("#exportAllTso").addEventListener("click", exportAllTso);
document.querySelector("#loadClients").addEventListener("click", loadClients);
document.querySelector("#exportClients").addEventListener("click", exportClients);
document.querySelector("#buildClientReport").addEventListener("click", buildClientReport);
document.querySelector("#exportClientReport").addEventListener("click", exportClientReport);
document.querySelector("#exportClientExcel").addEventListener("click", exportClientExcel);
document.querySelector("#backToCards").addEventListener("click", closeClientCard);
document.querySelector("#search").addEventListener("input", renderClients);
document.querySelector("#summaryFromDate").addEventListener("change", scheduleClientSummaryRefresh);
document.querySelector("#summaryToDate").addEventListener("change", scheduleClientSummaryRefresh);
document.querySelector("#cardSearch").addEventListener("input", renderClientCards);
document.querySelector("#clientCards").addEventListener("click", event => {
  const card = event.target.closest("[data-client-id]");
  if (card) openClientCard(card.dataset.clientId);
});

bootstrap();
