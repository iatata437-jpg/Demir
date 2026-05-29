package kg.demirbank.reports;

import android.app.Activity;
import android.app.DatePickerDialog;
import android.content.Intent;
import android.os.AsyncTask;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.DatePicker;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String TMS_HOST = BuildConfig.TMS_HOST;
    private static final String TMS_EMAIL = BuildConfig.TMS_EMAIL;
    private static final String TMS_PASSWORD = BuildConfig.TMS_PASSWORD;
    private static final String PROJECT_NAME = "bank-demir";

    private LinearLayout root;
    private LinearLayout metrics;
    private LinearLayout cards;
    private LinearLayout reportRows;
    private TextView status;
    private TextView detailTitle;
    private EditText fromDate;
    private EditText toDate;
    private ProgressBar progress;
    private Button reportButton;
    private Button excelButton;

    private final List<ClientCard> clients = new ArrayList<>();
    private final List<TmsTransaction> activeTransactions = new ArrayList<>();
    private ClientCard activeClient;
    private TmsApi api;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        api = new TmsApi();
        buildUi();
        setDefaultDates();
        loadClients();
    }

    private void buildUi() {
        ScrollView scroll = new ScrollView(this);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(28, 24, 28, 28);
        root.setBackgroundColor(0xFFF3F5F7);
        scroll.addView(root);

        LinearLayout header = panel();
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher);
        header.addView(logo, new LinearLayout.LayoutParams(72, 72));
        LinearLayout titleBox = new LinearLayout(this);
        titleBox.setOrientation(LinearLayout.VERTICAL);
        titleBox.setPadding(18, 0, 0, 0);
        TextView kicker = label("Demir Kyrgyz International Bank", 12, 0xFFCF1734, true);
        TextView title = label("Безналичные отчеты", 24, 0xFF15202B, true);
        TextView subtitle = label("TMS проект: bank-demir", 14, 0xFF637083, false);
        titleBox.addView(kicker);
        titleBox.addView(title);
        titleBox.addView(subtitle);
        header.addView(titleBox);
        root.addView(header);

        LinearLayout controls = panel();
        controls.setOrientation(LinearLayout.VERTICAL);
        fromDate = input();
        toDate = input();
        fromDate.setHint("С");
        toDate.setHint("По");
        fromDate.setOnClickListener(v -> pickDate(fromDate));
        toDate.setOnClickListener(v -> pickDate(toDate));
        controls.addView(label("Период отчета", 14, 0xFF637083, false));
        controls.addView(fromDate);
        controls.addView(toDate);
        root.addView(controls);

        status = label("Загружаем карточки ИП из TMS...", 15, 0xFF637083, false);
        LinearLayout statusPanel = panel();
        statusPanel.addView(status);
        progress = new ProgressBar(this);
        statusPanel.addView(progress);
        root.addView(statusPanel);

        metrics = new LinearLayout(this);
        metrics.setOrientation(LinearLayout.VERTICAL);
        root.addView(metrics);

        TextView cardsTitle = sectionTitle("Карточки ИП");
        root.addView(cardsTitle);
        cards = new LinearLayout(this);
        cards.setOrientation(LinearLayout.VERTICAL);
        root.addView(cards);

        LinearLayout detail = panel();
        detail.setOrientation(LinearLayout.VERTICAL);
        detailTitle = label("Выберите карточку", 20, 0xFF15202B, true);
        reportButton = button("Сформировать отчет по клиенту");
        excelButton = ghostButton("Скачать Excel");
        reportButton.setEnabled(false);
        excelButton.setVisibility(View.GONE);
        reportButton.setOnClickListener(v -> loadReport());
        excelButton.setOnClickListener(v -> shareExcel());
        detail.addView(detailTitle);
        detail.addView(reportButton);
        detail.addView(excelButton);
        root.addView(detail);

        TextView reportTitle = sectionTitle("Транзакции");
        root.addView(reportTitle);
        reportRows = new LinearLayout(this);
        reportRows.setOrientation(LinearLayout.VERTICAL);
        root.addView(reportRows);

        setContentView(scroll);
    }

    private LinearLayout panel() {
        LinearLayout layout = new LinearLayout(this);
        layout.setPadding(20, 18, 20, 18);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(0, 0, 0, 18);
        layout.setLayoutParams(params);
        layout.setBackgroundColor(0xFFFFFFFF);
        return layout;
    }

    private TextView sectionTitle(String text) {
        TextView view = label(text, 18, 0xFF15202B, true);
        view.setPadding(0, 8, 0, 12);
        return view;
    }

    private TextView label(String text, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(size);
        view.setTextColor(color);
        if (bold) view.setTypeface(null, 1);
        return view;
    }

    private EditText input() {
        EditText edit = new EditText(this);
        edit.setSingleLine(true);
        edit.setFocusable(false);
        edit.setTextSize(16);
        edit.setPadding(16, 8, 16, 8);
        return edit;
    }

    private Button button(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextColor(0xFFFFFFFF);
        button.setBackgroundColor(0xFFCF1734);
        return button;
    }

    private Button ghostButton(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextColor(0xFF9F1027);
        return button;
    }

    private void setDefaultDates() {
        Calendar to = Calendar.getInstance();
        Calendar from = Calendar.getInstance();
        from.add(Calendar.DAY_OF_MONTH, -7);
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        fromDate.setText(format.format(from.getTime()));
        toDate.setText(format.format(to.getTime()));
    }

    private void pickDate(EditText target) {
        Calendar calendar = Calendar.getInstance();
        DatePickerDialog dialog = new DatePickerDialog(this, (DatePicker view, int year, int month, int day) -> {
            target.setText(String.format(Locale.US, "%04d-%02d-%02d", year, month + 1, day));
        }, calendar.get(Calendar.YEAR), calendar.get(Calendar.MONTH), calendar.get(Calendar.DAY_OF_MONTH));
        dialog.show();
    }

    private void loadClients() {
        progress.setVisibility(View.VISIBLE);
        status.setText("Подключаемся к TMS...");
        new AsyncTask<Void, Void, Exception>() {
            @Override
            protected Exception doInBackground(Void... voids) {
                try {
                    clients.clear();
                    clients.addAll(api.loadBankDemirClients());
                    return null;
                } catch (Exception error) {
                    return error;
                }
            }

            @Override
            protected void onPostExecute(Exception error) {
                progress.setVisibility(View.GONE);
                if (error != null) {
                    status.setText("Ошибка TMS: " + error.getMessage());
                    return;
                }
                renderClients();
            }
        }.execute();
    }

    private void renderClients() {
        cards.removeAllViews();
        int terminals = 0;
        for (ClientCard client : clients) terminals += client.terminals.size();
        metrics.removeAllViews();
        metrics.addView(metric("Клиенты bank-demir", String.valueOf(clients.size())));
        metrics.addView(metric("Терминалов Demir", String.valueOf(terminals)));
        status.setText("Карточки ИП загружены из TMS.");

        for (ClientCard client : clients) {
            Button card = ghostButton(client.name + "\nTMS: " + client.orgName + "\n" + client.terminals.size() + " терминал(ов)");
            card.setGravity(Gravity.LEFT | Gravity.CENTER_VERTICAL);
            card.setPadding(18, 16, 18, 16);
            card.setOnClickListener(v -> selectClient(client));
            cards.addView(card);
        }
    }

    private TextView metric(String label, String value) {
        TextView view = label(label + ": " + value, 18, 0xFF15202B, true);
        view.setPadding(18, 14, 18, 14);
        view.setBackgroundColor(0xFFFFFFFF);
        return view;
    }

    private void selectClient(ClientCard client) {
        activeClient = client;
        activeTransactions.clear();
        detailTitle.setText(client.name + "\nTMS: " + client.orgName + "\nТерминалов: " + client.terminals.size());
        reportButton.setEnabled(true);
        excelButton.setVisibility(View.VISIBLE);
        excelButton.setEnabled(true);
        reportRows.removeAllViews();
        reportRows.addView(label("Выберите период и сформируйте отчет.", 15, 0xFF637083, false));
    }

    private void loadReport() {
        if (activeClient == null) return;
        progress.setVisibility(View.VISIBLE);
        status.setText("Запрашиваем отчет из TMS по " + activeClient.name + "...");
        new AsyncTask<Void, Void, Exception>() {
            List<TmsTransaction> result = new ArrayList<>();

            @Override
            protected Exception doInBackground(Void... voids) {
                try {
                    result = api.loadTsoReport(activeClient, fromDate.getText().toString(), toDate.getText().toString());
                    return null;
                } catch (Exception error) {
                    return error;
                }
            }

            @Override
            protected void onPostExecute(Exception error) {
                progress.setVisibility(View.GONE);
                if (error != null) {
                    status.setText("Ошибка отчета TMS: " + error.getMessage());
                    return;
                }
                activeTransactions.clear();
                activeTransactions.addAll(result);
                renderReport();
            }
        }.execute();
    }

    private void renderReport() {
        reportRows.removeAllViews();
        double total = 0;
        for (TmsTransaction tx : activeTransactions) total += tx.cashlessAmount;
        status.setText("Безналичный TSO сформирован. Терминалов: " + activeTransactions.size() + ", безнал: " + money(total));
        excelButton.setEnabled(true);
        if (activeTransactions.isEmpty()) {
            reportRows.addView(label("Безналичных операций за период нет.", 15, 0xFF637083, false));
            return;
        }
        for (TmsTransaction tx : activeTransactions) {
            TextView row = label(
                "Unit ID: " + empty(tx.unitId) + "\n" +
                    "Terminal ID: " + empty(tx.terminalId) + "\n" +
                    "Безнал операций: " + tx.cashlessSales + "\n" +
                    "Безнал: " + money(tx.cashlessAmount) + " · Errors: " + tx.errors,
                14,
                0xFF15202B,
                false
            );
            row.setPadding(16, 14, 16, 14);
            reportRows.addView(row);
        }
    }

    private void shareExcel() {
        if (activeClient == null) return;
        StringBuilder csv = new StringBuilder();
        csv.append("client,tms,unit_id,terminal_id,location,currency,cashless_sales,cashless_amount,errors\n");
        for (TmsTransaction tx : activeTransactions) {
            csv.append(csv(activeClient.name)).append(',')
                .append(csv(activeClient.orgName)).append(',')
                .append(csv(tx.unitId)).append(',')
                .append(csv(tx.terminalId)).append(',')
                .append(csv(tx.location)).append(',')
                .append(csv(tx.currency)).append(',')
                .append(tx.cashlessSales).append(',')
                .append(tx.cashlessAmount).append(',')
                .append(tx.errors).append('\n');
        }
        try {
            File file = new File(getExternalFilesDir(null), "TSO_" + activeClient.orgName + "_" + fromDate.getText() + "_" + toDate.getText() + ".csv");
            FileOutputStream stream = new FileOutputStream(file);
            stream.write(csv.toString().getBytes("UTF-8"));
            stream.close();
            status.setText("Excel CSV сохранен: " + file.getAbsolutePath());
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("text/csv");
            intent.putExtra(Intent.EXTRA_SUBJECT, "TSO " + activeClient.name);
            intent.putExtra(Intent.EXTRA_TEXT, csv.toString());
            startActivity(Intent.createChooser(intent, "Отправить Excel CSV"));
        } catch (Exception error) {
            status.setText("Не удалось сохранить Excel: " + error.getMessage());
        }
    }

    private String csv(String value) {
        return "\"" + empty(value).replace("\"", "\"\"") + "\"";
    }

    private String empty(String value) {
        return value == null || value.length() == 0 ? "-" : value;
    }

    private String money(double value) {
        return String.format(Locale.US, "%.2f сом", value);
    }

    static class ClientCard {
        String orgName;
        String name;
        List<Terminal> terminals = new ArrayList<>();
    }

    static class Terminal {
        String unitId;
        String terminalId;
        String serialNumber;
        String name;
    }

    static class TmsTransaction {
        String unitId;
        String terminalId;
        String location;
        String currency;
        int sales;
        int cashlessSales;
        int errors;
        double totalAmount;
        String occurredAt;
        String terminalName;
        String serialNumber;
        String status;
        String rrn;
        String invoice;
        String authId;
        double cashlessAmount;
    }

    static class TmsApi {
        private final Map<String, String> cookies = new LinkedHashMap<>();

        List<ClientCard> loadBankDemirClients() throws Exception {
            JSONArray orgs = getArray("/api/v1/org");
            JSONObject project = null;
            for (int i = 0; i < orgs.length(); i++) {
                JSONObject org = orgs.getJSONObject(i);
                if (PROJECT_NAME.equalsIgnoreCase(org.optString("display_name")) || PROJECT_NAME.equals(org.optString("name"))) {
                    project = org;
                    break;
                }
            }
            if (project == null) throw new Exception("Проект bank-demir не найден");
            String projectCode = project.optString("name");

            List<ClientCard> result = new ArrayList<>();
            for (int i = 0; i < orgs.length(); i++) {
                JSONObject org = orgs.getJSONObject(i);
                String displayName = org.optString("display_name", org.optString("name"));
                if (!projectCode.equals(org.optString("distributor"))) continue;
                if (!displayName.toLowerCase(Locale.US).startsWith("ip-")) continue;
                ClientCard client = new ClientCard();
                client.orgName = org.optString("name");
                client.name = displayName;
                client.terminals = loadTerminals(client.orgName);
                result.add(client);
            }
            return result;
        }

        List<Terminal> loadTerminals(String orgName) throws Exception {
            JSONArray units = getArray("/api/v1/org/" + enc(orgName) + "/unit");
            List<Terminal> terminals = new ArrayList<>();
            for (int i = 0; i < units.length(); i++) {
                JSONObject unit = units.getJSONObject(i);
                Terminal terminal = new Terminal();
                terminal.unitId = unit.optString("unit_id", unit.optString("id", unit.optString("sn")));
                terminal.terminalId = unit.optString("tid", unit.optString("terminal_id"));
                terminal.serialNumber = unit.optString("sn", unit.optString("serial_number"));
                terminal.name = unit.optString("name", terminal.unitId);
                terminals.add(terminal);
            }
            return terminals;
        }

        List<TmsTransaction> loadTsoReport(ClientCard client, String from, String to) throws Exception {
            List<TmsTransaction> result = new ArrayList<>();
            JSONObject payload = getObject("/api/reportv3/vend-summary/org/" + enc(client.orgName) + "?from=" + enc(from) + "&to=" + enc(to));
            JSONArray units = payload.optJSONArray("units");
            if (units == null) return result;
            for (int i = 0; i < units.length(); i++) {
                JSONObject raw = units.getJSONObject(i);
                TmsTransaction tx = new TmsTransaction();
                tx.unitId = raw.optString("unit_id");
                tx.terminalId = raw.optString("terminal_id");
                tx.location = raw.optString("location");
                tx.currency = raw.optString("currency", "KGS");
                tx.sales = raw.optInt("approved_count", 0);
                tx.cashlessSales = raw.optInt("approved_cashless_count", 0);
                tx.cashlessAmount = raw.optDouble("approved_cashless_amount", 0);
                tx.totalAmount = raw.optDouble("approved_amount", 0);
                tx.errors = raw.optInt("errored_count", 0) + raw.optInt("declined_count", 0);
                if (tx.cashlessSales > 0 || tx.cashlessAmount > 0) result.add(tx);
            }
            return result;
        }

        TmsTransaction parseTransaction(JSONObject raw, ClientCard client, Map<String, Terminal> terminals) {
            JSONArray payments = raw.optJSONArray("payment");
            JSONObject main = payments != null && payments.length() > 0 ? payments.optJSONObject(0) : new JSONObject();
            double cashless = 0;
            boolean approved = true;
            if (payments != null) {
                for (int i = 0; i < payments.length(); i++) {
                    JSONObject payment = payments.optJSONObject(i);
                    if (payment == null) continue;
                    cashless += payment.optDouble("cashless_amount", 0);
                    if (payment.has("approved") && !payment.optBoolean("approved")) approved = false;
                }
            }
            String unitId = raw.optString("unit_id");
            Terminal terminal = terminals.get(unitId);
            JSONObject body = main.optJSONObject("cashless_body");
            if (body == null) body = new JSONObject();
            TmsTransaction tx = new TmsTransaction();
            tx.occurredAt = main.optString("pos_localtime_at", raw.optString("pos_localtime_at"));
            tx.terminalName = terminal != null ? terminal.name : unitId;
            tx.serialNumber = terminal != null ? terminal.serialNumber : "";
            tx.status = raw.optBoolean("cancelled") ? "cancelled" : (approved && raw.optBoolean("completed") ? "approved" : "declined");
            tx.cashlessAmount = cashless;
            tx.rrn = body.optString("rrn");
            tx.invoice = body.optString("invoice");
            tx.authId = body.optString("auth_id");
            return tx;
        }

        JSONArray getArray(String path) throws Exception {
            Object value = request("GET", path, null);
            if (value instanceof JSONArray) return (JSONArray) value;
            throw new Exception("TMS вернул не список");
        }

        JSONObject getObject(String path) throws Exception {
            Object value = request("GET", path, null);
            if (value instanceof JSONObject) return (JSONObject) value;
            throw new Exception("TMS вернул не объект");
        }

        Object request(String method, String path, String body) throws Exception {
            ensureLogin();
            HttpURLConnection connection = open(method, path);
            if (body != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                OutputStream stream = connection.getOutputStream();
                stream.write(body.getBytes("UTF-8"));
                stream.close();
            }
            int code = connection.getResponseCode();
            saveCookies(connection);
            BufferedReader reader = new BufferedReader(new InputStreamReader(
                code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream(),
                "UTF-8"
            ));
            StringBuilder text = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) text.append(line);
            reader.close();
            if (code < 200 || code >= 300) throw new Exception("Vendotek " + code + ": " + text);
            String payload = text.toString();
            if (payload.startsWith("[")) return new JSONArray(payload);
            return new JSONObject(payload.length() == 0 ? "{}" : payload);
        }

        void ensureLogin() throws Exception {
            if (!cookies.isEmpty()) return;
            HttpURLConnection connection = open("POST", "/sign-in");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            String body = "{\"email\":\"" + TMS_EMAIL + "\",\"password\":\"" + TMS_PASSWORD.replace("\\", "\\\\").replace("\"", "\\\"") + "\"}";
            OutputStream stream = connection.getOutputStream();
            stream.write(body.getBytes("UTF-8"));
            stream.close();
            int code = connection.getResponseCode();
            saveCookies(connection);
            if (code < 200 || code >= 300) throw new Exception("login " + code);
        }

        HttpURLConnection open(String method, String path) throws Exception {
            HttpURLConnection connection = (HttpURLConnection) new URL(TMS_HOST + path).openConnection();
            connection.setRequestMethod(method);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Origin", TMS_HOST);
            connection.setRequestProperty("Referer", TMS_HOST + "/");
            connection.setRequestProperty("User-Agent", "Mozilla/5.0 DemirReports Android");
            connection.setRequestProperty("X-Requested-With", "XMLHttpRequest");
            if (!cookies.isEmpty()) connection.setRequestProperty("Cookie", cookieHeader());
            return connection;
        }

        void saveCookies(HttpURLConnection connection) {
            Map<String, List<String>> headers = connection.getHeaderFields();
            for (Map.Entry<String, List<String>> header : headers.entrySet()) {
                if (header.getKey() == null || !"set-cookie".equalsIgnoreCase(header.getKey())) continue;
                for (String cookie : header.getValue()) {
                    String pair = cookie.split(";", 2)[0];
                    int delimiter = pair.indexOf('=');
                    if (delimiter > 0) cookies.put(pair.substring(0, delimiter), pair.substring(delimiter + 1));
                }
            }
        }

        String cookieHeader() {
            StringBuilder builder = new StringBuilder();
            for (Map.Entry<String, String> entry : cookies.entrySet()) {
                if (builder.length() > 0) builder.append("; ");
                builder.append(entry.getKey()).append("=").append(entry.getValue());
            }
            return builder.toString();
        }

        String enc(String value) {
            return value.replace(" ", "%20");
        }

        long parseDate(String value, boolean end) throws Exception {
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US);
            return format.parse(value + (end ? " 23:59:59" : " 00:00:00")).getTime();
        }

        long parseDateTime(String value) {
            if (value == null || value.length() < 10) return 0;
            try {
                String normalized = value.replace('T', ' ');
                if (normalized.length() > 19) normalized = normalized.substring(0, 19);
                return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).parse(normalized).getTime();
            } catch (Exception ignored) {
                return 0;
            }
        }
    }
}
