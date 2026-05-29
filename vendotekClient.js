class VendotekClient {
  constructor(options = {}) {
    this.host = (options.host || "https://my.vendotek.com").replace(/\/$/, "");
    this.email = options.email || "";
    this.password = options.password || "";
    this.apiKey = options.apiKey || "";
    this.autoGenerateApiKey = Boolean(options.autoGenerateApiKey);
    this.cookies = new Map();
  }

  async fetchOrganizations() {
    await this.ensureAuth();
    return this.apiGet("/api/v1/org");
  }

  async fetchEnv() {
    await this.ensureAuth();
    return this.sessionGetJson("/api/env");
  }

  async fetchSelf() {
    await this.ensureAuth();
    return this.tryRequest(() => this.sessionGetJson("/api/self"))
      || this.tryRequest(() => this.sessionGetJson("/api/user/self"));
  }

  async fetchUnits(orgName) {
    await this.ensureAuth();
    return this.apiGet(`/api/v1/org/${encodeURIComponent(orgName)}/unit`);
  }

  async fetchVends(orgName, options = {}) {
    await this.ensureAuth();
    const minId = Number(options.minId || 0);
    const restarted = options.restarted === false ? "false" : "true";
    return this.apiGet(`/api/v1/org/${encodeURIComponent(orgName)}/vend/?min-id=${encodeURIComponent(minId)}&restarted=${restarted}`);
  }

  async fetchTsoReport(orgName, from, to) {
    await this.ensureAuth();
    return this.sessionGetJson(`/api/reportv3/vend-summary/org/${encodeURIComponent(orgName)}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  }

  async fetchTsoReportCsv(orgName, from, to) {
    await this.ensureAuth();
    const report = await this.fetchTsoReport(orgName, from, to);
    const rows = (Array.isArray(report?.units) ? report.units : [])
      .filter(row => Number(row.approved_cashless_count || 0) > 0 || Number(row.approved_cashless_amount || 0) > 0);
    return [
      "sep=;",
      "Unit ID;Terminal ID;Location;Currency;Cashless Sales;Cashless Amount;Connection Errors;Other Errors",
      ...rows.map(row => [
        row.unit_id || "",
        row.terminal_id || "",
        csvCell(row.location || ""),
        row.currency || "",
        Number(row.approved_cashless_count || 0),
        Number(row.approved_cashless_amount || 0),
        Number(row.errored_count || 0),
        Number(row.declined_count || 0)
      ].join(";"))
    ].join("\r\n");
  }

  async fetchTsoReportCsvRaw(orgName, from, to) {
    await this.ensureAuth();
    return this.requestText(`/api/reportv3/vend-summary/org/${encodeURIComponent(orgName)}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
      headers: {
        ...this.sessionHeaders(),
        Accept: "text/csv"
      }
    });
  }

  async ensureAuth() {
    if (this.apiKey) return;
    if (!this.email || !this.password) {
      throw new Error("Не указан VENDOTEK_API_KEY или логин/пароль Vendotek");
    }

    await this.sessionPostJson("/sign-in", {
      email: this.email,
      password: this.password
    });

    const self = await this.tryRequest(() => this.sessionGetJson("/api/self"))
      || await this.tryRequest(() => this.sessionGetJson("/api/user/self"));
    if (self?.api_key) {
      this.apiKey = self.api_key;
      return;
    }

    if (!this.autoGenerateApiKey) return;

    const generated = await this.sessionPostJson("/api/user/self/regenerate-api-key", {});
    if (!generated?.api_key) {
      throw new Error("Vendotek не вернул api_key после генерации");
    }
    this.apiKey = generated.api_key;
  }

  async apiGet(path) {
    return this.requestJson(path, {
      headers: this.apiKey
        ? { Authorization: `Bearer ${this.apiKey}` }
        : this.sessionHeaders()
    });
  }

  async sessionGetJson(path) {
    return this.requestJson(path, { headers: this.sessionHeaders() });
  }

  async sessionPostJson(path, body) {
    return this.requestJson(path, {
      method: "POST",
      headers: {
        ...this.sessionHeaders(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
  }

  async requestJson(path, options = {}) {
    const text = await this.requestText(path, options);
    return text ? JSON.parse(text) : {};
  }

  async requestText(path, options = {}) {
    const response = await fetch(`${this.host}${path}`, {
      redirect: "manual",
      ...options,
      headers: {
        Accept: "application/json",
        Origin: this.host,
        Referer: `${this.host}/`,
        "User-Agent": "Mozilla/5.0",
        "X-Requested-With": "XMLHttpRequest",
        ...(options.headers || {})
      }
    });

    this.storeCookies(response.headers);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        const redirectUrl = new URL(location, this.host);
        return this.requestText(`${redirectUrl.pathname}${redirectUrl.search}`, options);
      }
    }

    const text = await response.text();
    if (!response.ok) {
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = null;
      }
      const message = payload?.message || payload?.error || text || response.statusText;
      throw new Error(`Vendotek ${response.status}: ${message}`);
    }
    return text;
  }

  async tryRequest(factory) {
    try {
      return await factory();
    } catch {
      return null;
    }
  }

  sessionHeaders() {
    const cookie = Array.from(this.cookies.entries())
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
    return cookie ? { Cookie: cookie } : {};
  }

  storeCookies(headers) {
    const setCookie = headers.getSetCookie ? headers.getSetCookie() : splitSetCookie(headers.get("set-cookie"));
    for (const cookie of setCookie) {
      const [pair] = cookie.split(";");
      const delimiter = pair.indexOf("=");
      if (delimiter > 0) {
        this.cookies.set(pair.slice(0, delimiter), pair.slice(delimiter + 1));
      }
    }
  }
}

function splitSetCookie(header) {
  if (!header) return [];
  return header.split(/,(?=\s*[^;=]+=[^;]+)/g);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[;\r\n"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

module.exports = { VendotekClient };
