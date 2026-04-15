const state = {
  currentCaseMode: "advocate",
  sessionId: null,
  benches: [],
  caseTypes: [],
  lastSearchPayload: null,
  lastSearchKind: null,
};

const refs = {
  tabs: document.querySelectorAll(".tab[data-tab]"),
  panels: document.querySelectorAll(".panel"),
  modeTabs: document.querySelectorAll(".tab[data-mode]"),
  causeQuery: document.getElementById("causeQuery"),
  causeLabel: document.getElementById("causeLabel"),
  causeStartDate: document.getElementById("causeStartDate"),
  causeDays: document.getElementById("causeDays"),
  causeNotes: document.getElementById("causeNotes"),
  causeStatus: document.getElementById("causeStatus"),
  syncStatusNote: document.getElementById("syncStatusNote"),
  causeSideSelect: document.getElementById("causeSideSelect"),
  causeTypeSelectFilter: document.getElementById("causeTypeSelectFilter"),
  benchSelect: document.getElementById("benchSelect"),
  statusFilter: document.getElementById("statusFilter"),
  captchaPreview: document.getElementById("captchaPreview"),
  captchaInput: document.getElementById("captchaInput"),
  partyName: document.getElementById("partyName"),
  partyYear: document.getElementById("partyYear"),
  advocateName: document.getElementById("advocateName"),
  advocateLabel: document.getElementById("advocateLabel"),
  caseTypeSelect: document.getElementById("caseTypeSelect"),
  caseNumberInput: document.getElementById("caseNumberInput"),
  caseYearInput: document.getElementById("caseYearInput"),
  caseStatusStatus: document.getElementById("caseStatusStatus"),
  resultsView: document.getElementById("resultsView"),
  resultsRaw: document.getElementById("results"),
  resultMode: document.getElementById("resultMode"),
  resultMeta: document.getElementById("resultMeta"),
  savedSearchTypeSelect: document.getElementById("savedSearchTypeSelect"),
  savedDataTypeSelect: document.getElementById("savedDataTypeSelect"),
  savedSearchGroupTitle: document.getElementById("savedSearchGroupTitle"),
  savedSearchGroupNote: document.getElementById("savedSearchGroupNote"),
  savedDataGroupTitle: document.getElementById("savedDataGroupTitle"),
  savedDataGroupNote: document.getElementById("savedDataGroupNote"),
  savedSearchesList: document.getElementById("savedSearchesList"),
  savedDataList: document.getElementById("savedDataList"),
  causeSearchBtn: document.getElementById("causeSearchBtn"),
  causeSaveBtn: document.getElementById("causeSaveBtn"),
  syncCauseListsBtn: document.getElementById("syncCauseListsBtn"),
  loadCaptchaBtn: document.getElementById("loadCaptchaBtn"),
  refreshCaptchaBtn: document.getElementById("refreshCaptchaBtn"),
  caseStatusSearchBtn: document.getElementById("caseStatusSearchBtn"),
  caseStatusSaveBtn: document.getElementById("caseStatusSaveBtn"),
  partyFields: document.getElementById("partyFields"),
  advocateFields: document.getElementById("advocateFields"),
  caseNumberFields: document.getElementById("caseNumberFields"),
};

refs.causeStartDate.value = new Date().toISOString().slice(0, 10);

const buttonLabels = new Map(
  [
    refs.causeSearchBtn,
    refs.causeSaveBtn,
    refs.syncCauseListsBtn,
    refs.loadCaptchaBtn,
    refs.refreshCaptchaBtn,
    refs.caseStatusSearchBtn,
    refs.caseStatusSaveBtn,
  ]
    .filter(Boolean)
    .map((button) => [button, button.textContent]),
);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nowLabel() {
  return new Date().toLocaleString();
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const bodyText = await response.text();
  const data = bodyText ? JSON.parse(bodyText) : {};
  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function setButtonBusy(button, busy, busyLabel) {
  if (!button) {
    return;
  }

  button.disabled = busy;
  button.classList.toggle("busy", busy);
  button.textContent = busy ? busyLabel : buttonLabels.get(button) || button.textContent;
}

async function withBusy(button, busyLabel, task, onError) {
  setButtonBusy(button, true, busyLabel);
  try {
    return await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    if (onError) {
      onError(message);
    }
    throw error;
  } finally {
    setButtonBusy(button, false, busyLabel);
  }
}

function emptyCollection(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function text(value, fallback = "-") {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized && normalized !== "NA" && normalized !== "N/A" && normalized !== "N" ? normalized : fallback;
}

function sideLabel(value) {
  return {
    A: "Appellate Side",
    O: "Original Side",
    J: "Jalpaiguri",
    P: "Port Blair",
  }[value] || value;
}

function listTypeLabel(value) {
  return {
    D: "Daily",
    M: "Monthly",
    S: "Supplementary 1",
    S2: "Supplementary 2",
    S3: "Supplementary 3",
    S4: "Supplementary 4",
    S5: "Supplementary 5",
    LA: "Lok Adalat",
  }[value] || value;
}

function coerceCaseStatusDisplay(payload) {
  if (payload && typeof payload === "object" && payload.view === "records" && Array.isArray(payload.records)) {
    return payload;
  }

  if (payload && typeof payload === "object" && payload.view === "html" && typeof payload.html === "string") {
    return payload;
  }

  if (payload && typeof payload === "object" && payload.view === "message") {
    if (payload.raw) {
      const retried = coerceCaseStatusDisplay(payload.raw);
      if (retried.view !== "message") {
        return retried;
      }
    }
    return payload;
  }

  if (payload?.con === "Invalid Captcha" || payload === "Invalid Captcha") {
    return {
      view: "message",
      totalRecords: 0,
      pendingCount: 0,
      disposedCount: 0,
      records: [],
      html: null,
      message: "The captcha did not match this session. Load a fresh captcha and try again.",
      raw: payload,
    };
  }

  if (typeof payload?.html === "string") {
    return payload;
  }

  if (typeof payload?.con === "string" && payload.con.trim().startsWith("<")) {
    return {
      view: "html",
      totalRecords: Number(payload.totRecords || 0),
      pendingCount: 0,
      disposedCount: 0,
      records: [],
      html: payload.con,
      message: null,
      raw: payload,
    };
  }

  return {
    view: "message",
    totalRecords: 0,
    pendingCount: 0,
    disposedCount: 0,
    records: [],
    html: null,
    message: payload?.message || "Readable case-status results were not available in this response.",
    raw: payload,
  };
}

function renderCauseListResults(data) {
  const matchedCases = (data.results || []).reduce((sum, item) => sum + (item.matchCount || 0), 0);
  const cards = (data.results || []).map((item) => `
    <div class="result-block">
      <h3>${escapeHtml(item.date)} | ${escapeHtml(sideLabel(item.side))} | ${escapeHtml(listTypeLabel(item.listType))}</h3>
      <div class="kv">${escapeHtml(item.matchCount)} matched case(s) | Last synced ${escapeHtml(new Date(item.fetchedAt).toLocaleString())}</div>
      <div class="case-list">
        ${(item.matches || []).slice(0, 20).map((entry) => `
          <div class="case-row">
            <div class="kv">Serial No: ${escapeHtml(entry.serial || "-")}</div>
            <strong>${escapeHtml(entry.primaryCaseNumber || entry.caseNumbers?.[0] || "Case")}</strong>
            <div>${escapeHtml(entry.parties || "")}</div>
            <div class="kv">Advocate: ${escapeHtml(entry.advocates || "-")}</div>
            <div class="kv">Section: ${escapeHtml(entry.section || "-")}</div>
            <div class="kv">Court: ${escapeHtml(entry.courtNo || "-")}</div>
            <div class="kv">Bench: ${escapeHtml(entry.bench || "-")}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");

  return `
    <div class="summary-grid">
      <div class="summary-card">Search<strong>${escapeHtml(data.query)}</strong></div>
      <div class="summary-card">Lists With Matches<strong>${escapeHtml(data.totalListsWithMatches || 0)}</strong></div>
      <div class="summary-card">Matched Cases<strong>${escapeHtml(matchedCases)}</strong></div>
      <div class="summary-card">Range<strong>${escapeHtml(data.startDate)} to ${escapeHtml(data.endDate || data.startDate)}</strong></div>
    </div>
    <div class="result-block">
      <div class="kv">Sides: ${escapeHtml((data.sides || []).map(sideLabel).join(", ") || "All")}</div>
      <div class="kv">Types: ${escapeHtml((data.listTypes || []).map(listTypeLabel).join(", ") || "All")}</div>
    </div>
    ${cards || `<div class="result-block">No cached cause-list matches were found for this search range.</div>`}
  `;
}

function renderCaseStatusResults(payload) {
  const display = coerceCaseStatusDisplay(payload);

  if (display.view === "message") {
    return `<div class="result-block">${escapeHtml(display.message)}</div>`;
  }

  if (display.view === "html" && display.html) {
    return `
      <div class="summary-grid">
        <div class="summary-card">Total Matters<strong>${escapeHtml(display.totalRecords || 0)}</strong></div>
      </div>
      <div class="html-result">${display.html}</div>
    `;
  }

  const rows = display.records.map((record) => `
    <tr>
      <td>${escapeHtml(record.resultNumber)}</td>
      <td>
        <div class="table-main">${escapeHtml(record.caseTypeName)}/${escapeHtml(record.caseNumber)}</div>
        <div class="table-sub">${escapeHtml(record.fullCaseNumber)}</div>
      </td>
      <td>
        <div class="table-main">${escapeHtml(record.petitioner)}</div>
        <div class="table-sub">Versus ${escapeHtml(record.respondent)}</div>
      </td>
      <td>${escapeHtml(record.advocate)}</td>
      <td>
        <span class="badge ${record.status === "Disposed" ? "disposed" : "pending"}">${escapeHtml(record.status)}</span>
        <div class="table-sub">${escapeHtml(record.decisionDate || "Awaiting disposal")}</div>
      </td>
      <td>
        ${record.viewUrl ? `<a href="${escapeHtml(record.viewUrl)}" target="_blank" rel="noreferrer">View</a>` : "-"}
      </td>
    </tr>
  `).join("");

  return `
    <div class="summary-grid">
      <div class="summary-card">Total Matters<strong>${escapeHtml(display.totalRecords)}</strong></div>
      <div class="summary-card">Pending Matters<strong>${escapeHtml(display.pendingCount)}</strong></div>
      <div class="summary-card">Disposed Matters<strong>${escapeHtml(display.disposedCount)}</strong></div>
    </div>
    <div class="data-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Sr No</th>
            <th>Case Type/Case Number/Case Year</th>
            <th>Petitioner Name Versus Respondent Name</th>
            <th>Advocate Name</th>
            <th>Status</th>
            <th>View</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderReadableResults(kind, payload) {
  if (!payload) {
    refs.resultsView.innerHTML = emptyCollection("No result loaded yet.");
    return;
  }

  refs.resultsView.innerHTML = kind === "causeList"
    ? renderCauseListResults(payload)
    : kind === "caseStatus"
      ? renderCaseStatusResults(payload)
      : emptyCollection("Result loaded. See raw JSON below for details.");
}

function updateResultMeta(kind, payload) {
  if (!kind || !payload) {
    refs.resultMeta.textContent = "Waiting for your first search.";
    return;
  }

  if (kind === "causeList") {
    const matchedCases = (payload.results || []).reduce((sum, item) => sum + (item.matchCount || 0), 0);
    refs.resultMeta.textContent = `Updated ${nowLabel()} | ${payload.totalListsWithMatches || 0} list(s) | ${matchedCases} matched case(s)`;
    return;
  }

  if (kind === "caseStatus") {
    const display = coerceCaseStatusDisplay(payload);
    refs.resultMeta.textContent = `Updated ${nowLabel()} | ${display.totalRecords || 0} matter(s)`;
    return;
  }

  refs.resultMeta.textContent = `Updated ${nowLabel()}`;
}

function emptyResultMessageForPanel(panelId) {
  if (panelId === "caseStatusPanel") {
    return "Run a case-status search to see readable case results here.";
  }
  if (panelId === "savedSearchesPanel") {
    return "Open or rerun a saved search to load its latest result here.";
  }
  if (panelId === "savedDataPanel") {
    return "Open a saved snapshot to load the stored result here.";
  }
  return "Use the forms on the left to search, save, or reopen a stored snapshot.";
}

function clearOutput(panelId = null) {
  state.lastSearchPayload = null;
  state.lastSearchKind = null;
  refs.resultMode.textContent = "No search run yet";
  refs.resultMode.className = "pill";
  refs.resultMeta.textContent = "Waiting for your first search.";
  refs.resultsView.innerHTML = emptyCollection(emptyResultMessageForPanel(panelId));
  refs.resultsRaw.textContent = "Use the forms on the left to search or save data.";
}

function setOutput(label, payload, kind = null) {
  refs.resultMode.textContent = label;
  refs.resultMode.className = `pill${kind === "causeList" ? " accent" : kind === "caseStatus" ? " blue" : ""}`;
  refs.resultsRaw.textContent = JSON.stringify(payload, null, 2);
  state.lastSearchPayload = payload;
  state.lastSearchKind = kind;
  updateResultMeta(kind, payload);
  renderReadableResults(kind, payload);
}

function summarizeLatestRun(latestRun) {
  if (!latestRun) {
    return "No saved result yet.";
  }

  if (latestRun.sourceType.startsWith("cause_list")) {
    const data = latestRun.resultJson;
    const matchedCases = (data.results || []).reduce((sum, item) => sum + (item.matchCount || 0), 0);
    return `${data.totalListsWithMatches || 0} list(s), ${matchedCases} matched case(s), saved ${new Date(latestRun.createdAt).toLocaleString()}`;
  }

  const display = coerceCaseStatusDisplay(latestRun.resultJson);
  return `${display.totalRecords || 0} matter(s), saved ${new Date(latestRun.createdAt).toLocaleString()}`;
}

function summarizeSavedData(latestRun) {
  if (!latestRun) {
    return `<div class="saved-meta">No saved data yet.</div>`;
  }

  if (latestRun.sourceType.startsWith("cause_list")) {
    const data = latestRun.resultJson;
    const matchedCases = (data.results || []).reduce((sum, item) => sum + (item.matchCount || 0), 0);
    return `
      <div class="saved-meta">Cause-list snapshot</div>
      <div class="saved-meta">${escapeHtml(data.query || "")}</div>
      <div class="saved-meta">${escapeHtml(data.totalListsWithMatches || 0)} list(s), ${escapeHtml(matchedCases)} matched case(s)</div>
      <div class="saved-meta">Saved: ${escapeHtml(new Date(latestRun.createdAt).toLocaleString())}</div>
    `;
  }

  const display = coerceCaseStatusDisplay(latestRun.resultJson);
  return `
    <div class="saved-meta">Case-status snapshot</div>
    <div class="saved-meta">${escapeHtml(display.totalRecords || 0)} matter(s)</div>
    <div class="saved-meta">Pending: ${escapeHtml(display.pendingCount || 0)} | Disposed: ${escapeHtml(display.disposedCount || 0)}</div>
    <div class="saved-meta">Saved: ${escapeHtml(new Date(latestRun.createdAt).toLocaleString())}</div>
  `;
}

function isCauseSearch(item) {
  return item.searchType === "cause_list_text";
}

function isCauseSnapshot(item) {
  return item.latestRun?.sourceType?.startsWith("cause_list");
}

function updateSavedSearchGroup(type) {
  if (type === "caseStatus") {
    refs.savedSearchGroupTitle.textContent = "Case Status Searches";
    refs.savedSearchGroupNote.textContent = "Saved party, advocate, and case-number checks.";
    return;
  }

  refs.savedSearchGroupTitle.textContent = "Cause List Searches";
  refs.savedSearchGroupNote.textContent = "Saved lawyer, party, and case-text searches for upcoming lists.";
}

function updateSavedDataGroup(type) {
  if (type === "caseStatus") {
    refs.savedDataGroupTitle.textContent = "Case Status Results";
    refs.savedDataGroupNote.textContent = "Latest stored case-status snapshots.";
    return;
  }

  refs.savedDataGroupTitle.textContent = "Cause List Results";
  refs.savedDataGroupNote.textContent = "Latest stored cause-list match snapshots.";
}

function renderSavedSearchCard(item) {
  return `
    <div class="saved-item">
      <div class="section-title">
        <strong>${escapeHtml(item.label)}</strong>
        <span class="pill ${isCauseSearch(item) ? "accent" : "blue"}">${escapeHtml(isCauseSearch(item) ? "Cause List" : "Case Status")}</span>
      </div>
      <div class="saved-meta">${escapeHtml(item.queryText || "")}${item.caseNumber ? ` Case ${escapeHtml(item.caseNumber)}/${escapeHtml(item.year)}` : ""}</div>
      ${item.filtersJson?.listTypes ? `<div class="saved-meta">Types: ${item.filtersJson.listTypes.map(listTypeLabel).join(", ")}</div>` : ""}
      ${item.filtersJson?.sides ? `<div class="saved-meta">Sides: ${item.filtersJson.sides.map(sideLabel).join(", ")}</div>` : ""}
      ${item.courtCode ? `<div class="saved-meta">Bench Code: ${escapeHtml(item.courtCode)}</div>` : ""}
      <div class="saved-meta">Updated: ${new Date(item.updatedAt).toLocaleString()}</div>
      <div class="saved-meta">${summarizeLatestRun(item.latestRun)}</div>
      <div class="saved-actions">
        <button onclick="window.__rerunSavedSearch(${item.id}, '${item.searchType}')">Run</button>
        <button class="ghost" onclick="window.__viewLatestSavedRun(${item.id})">View Latest</button>
        <button class="ghost" onclick="window.__deleteSavedSearch(${item.id})">Delete</button>
      </div>
    </div>
  `;
}

function renderSavedDataCard(item) {
  return `
    <div class="saved-item">
      <div class="section-title">
        <strong>${escapeHtml(item.label)}</strong>
        <span class="pill ${isCauseSnapshot(item) ? "accent" : "blue"}">${escapeHtml(isCauseSnapshot(item) ? "Cause List Result" : "Case Status Result")}</span>
      </div>
      ${summarizeSavedData(item.latestRun)}
      <div class="saved-actions">
        <button class="ghost" onclick="window.__viewLatestSavedRun(${item.id})">Open Snapshot</button>
        <button onclick="window.__rerunSavedSearch(${item.id}, '${item.searchType}')">Refresh Data</button>
        <button class="ghost" onclick="window.__deleteSavedSearch(${item.id})">Delete</button>
      </div>
    </div>
  `;
}

function getSelectedCauseFilters() {
  return {
    sides: refs.causeSideSelect.value ? [refs.causeSideSelect.value] : [],
    listTypes: refs.causeTypeSelectFilter.value ? [refs.causeTypeSelectFilter.value] : [],
  };
}

function setCaseMode(mode) {
  state.currentCaseMode = mode;
  refs.modeTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
  refs.partyFields.style.display = mode === "party" ? "grid" : "none";
  refs.advocateFields.style.display = mode === "advocate" ? "grid" : "none";
  refs.caseNumberFields.style.display = mode === "caseNumber" ? "grid" : "none";
}

function getSelectedBench() {
  const courtCode = refs.benchSelect.value || "";
  const selected = state.benches.find((item) => item.value === courtCode) || null;
  return {
    courtCode,
    benchLabel: selected?.label || "Unknown Bench",
  };
}

async function loadBenches() {
  const data = await api("/api/case-status/benches");
  state.benches = (data.benches || []).filter((item) => item.value !== "0");
  if (!state.benches.length) {
    refs.benchSelect.innerHTML = `<option value="">No benches available</option>`;
    throw new Error("No benches were returned by the eCourts service.");
  }

  refs.benchSelect.innerHTML = state.benches.map((item) => `<option value="${item.value}">${item.label}</option>`).join("");
  refs.benchSelect.value = state.benches[0].value;
  await loadCaseTypes();
}

async function loadCaseTypes() {
  const { courtCode, benchLabel } = getSelectedBench();
  if (!courtCode) {
    return;
  }

  try {
    const data = await api(`/api/case-status/case-types?courtCode=${encodeURIComponent(courtCode)}`);
    state.caseTypes = (data.caseTypes || []).filter((item) => item.value !== "0");
    refs.caseTypeSelect.innerHTML = state.caseTypes.length
      ? state.caseTypes.map((item) => `<option value="${item.value}">${item.label}</option>`).join("")
      : `<option value="">No case types found for ${escapeHtml(benchLabel)}</option>`;
  } catch (error) {
    refs.caseTypeSelect.innerHTML = `<option value="">Case types unavailable</option>`;
    refs.caseStatusStatus.textContent = error instanceof Error ? error.message : "Could not load case types.";
  }
}

async function loadCaptchaSession() {
  refs.caseStatusStatus.textContent = "Loading captcha session...";
  const data = await api("/api/case-status/session", { method: "POST" });
  state.sessionId = data.sessionId;
  refs.captchaPreview.innerHTML = `<img src="${data.captchaImageUrl}?t=${Date.now()}" alt="captcha" style="width:100%;height:auto;">`;
  refs.caseStatusStatus.textContent = "Captcha loaded. Enter it and run your search.";
}

function refreshCaptchaImage() {
  if (!state.sessionId) {
    throw new Error("Load a captcha session first.");
  }

  refs.captchaPreview.innerHTML = `<img src="/api/case-status/session/${state.sessionId}/captcha?t=${Date.now()}" alt="captcha" style="width:100%;height:auto;">`;
  refs.caseStatusStatus.textContent = "Captcha refreshed for the current session.";
}

async function searchCauseLists() {
  refs.causeStatus.textContent = "Searching synced cause lists...";
  const filters = getSelectedCauseFilters();
  const data = await api(
    `/api/cause-lists/cache/search?query=${encodeURIComponent(refs.causeQuery.value.trim())}&startDate=${encodeURIComponent(refs.causeStartDate.value)}&days=${encodeURIComponent(refs.causeDays.value)}&sides=${encodeURIComponent(filters.sides.join(","))}&listTypes=${encodeURIComponent(filters.listTypes.join(","))}`,
  );
  refs.causeStatus.textContent = `Found ${data.totalListsWithMatches || 0} synced cause-list file(s) with matches.`;
  setOutput("Synced Cause Lists", data, "causeList");
  return data;
}

async function refreshSyncStatus() {
  const data = await api("/api/cause-lists/sync/status");
  const status = data.status;
  refs.syncStatusNote.textContent = status?.last_message
    ? `${status.last_status === "ok" ? "Sync success." : "Sync warning."} ${status.last_message} Last run: ${new Date(status.last_run_at).toLocaleString()}`
    : "No sync has run yet.";
}

async function runCauseListSync() {
  refs.syncStatusNote.textContent = "Syncing cause lists from the official website...";
  const data = await api("/api/cause-lists/sync/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      startDate: refs.causeStartDate.value,
      days: Math.min(Number(refs.causeDays.value || 7), 7),
      ...getSelectedCauseFilters(),
    }),
  });
  refs.syncStatusNote.textContent = data.status === "ok" ? `Sync success. ${data.message}` : `Sync warning. ${data.message}`;
  await refreshSyncStatus();
}

async function saveCauseSearch() {
  const currentResult =
    state.lastSearchKind === "causeList" && state.lastSearchPayload?.query === refs.causeQuery.value.trim()
      ? state.lastSearchPayload
      : await searchCauseLists();

  const data = await api("/api/saved-searches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      label: refs.causeLabel.value.trim() || `Track ${refs.causeQuery.value.trim()}`,
      searchType: "cause_list_text",
      queryText: refs.causeQuery.value.trim(),
      filtersJson: getSelectedCauseFilters(),
      notes: refs.causeNotes.value.trim() || null,
      initialRun: {
        sourceType: "cause_list_cache_search",
        resultJson: currentResult,
      },
    }),
  });
  refs.causeStatus.textContent = `Saved search #${data.id} with the current cause-list snapshot.`;
  await loadSavedSearches();
}

async function runCaseStatusSearch() {
  if (!state.sessionId) {
    throw new Error("Load a captcha session first.");
  }

  const { courtCode, benchLabel } = getSelectedBench();
  if (!courtCode) {
    throw new Error("Select a bench first.");
  }

  refs.caseStatusStatus.textContent = `Running case-status search for ${benchLabel}...`;

  let data;
  if (state.currentCaseMode === "party") {
    data = await api("/api/case-status/search/party-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        captcha: refs.captchaInput.value.trim(),
        courtCode,
        partyName: refs.partyName.value.trim(),
        year: refs.partyYear.value.trim(),
        statusFilter: refs.statusFilter.value,
      }),
    });
  } else if (state.currentCaseMode === "advocate") {
    data = await api("/api/case-status/search/advocate-name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        captcha: refs.captchaInput.value.trim(),
        courtCode,
        advocateName: refs.advocateName.value.trim(),
        statusFilter: refs.statusFilter.value,
      }),
    });
  } else {
    data = await api("/api/case-status/search/case-number", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: state.sessionId,
        captcha: refs.captchaInput.value.trim(),
        courtCode,
        caseType: refs.caseTypeSelect.value,
        caseNumber: refs.caseNumberInput.value.trim(),
        year: refs.caseYearInput.value.trim(),
      }),
    });
  }

  refs.caseStatusStatus.textContent = "Search completed.";
  setOutput("Case Status", data, "caseStatus");
  return data;
}

async function saveCaseStatusSearch() {
  const { courtCode, benchLabel } = getSelectedBench();
  if (!courtCode) {
    throw new Error("Select a bench first.");
  }

  const basePayload =
    state.currentCaseMode === "party"
      ? {
          label: `Party: ${refs.partyName.value.trim()} (${benchLabel})`,
          searchType: "case_status_party",
          queryText: refs.partyName.value.trim(),
          courtCode,
          statusFilter: refs.statusFilter.value,
          year: refs.partyYear.value.trim(),
        }
      : state.currentCaseMode === "advocate"
        ? {
            label: refs.advocateLabel.value.trim() || `Advocate: ${refs.advocateName.value.trim()} (${benchLabel})`,
            searchType: "case_status_advocate",
            queryText: refs.advocateName.value.trim(),
            courtCode,
            statusFilter: refs.statusFilter.value,
          }
        : {
            label: `Case: ${refs.caseNumberInput.value.trim()}/${refs.caseYearInput.value.trim()} (${benchLabel})`,
            searchType: "case_status_case_number",
            courtCode,
            caseType: refs.caseTypeSelect.value,
            caseNumber: refs.caseNumberInput.value.trim(),
            year: refs.caseYearInput.value.trim(),
          };

  const currentResult = state.lastSearchKind === "caseStatus" ? state.lastSearchPayload : await runCaseStatusSearch();
  const data = await api("/api/saved-searches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...basePayload,
      notes: "Saved from dashboard",
      initialRun: {
        sourceType: basePayload.searchType,
        resultJson: currentResult,
      },
    }),
  });
  refs.caseStatusStatus.textContent = `Saved search #${data.id} with the current case-status snapshot.`;
  await loadSavedSearches();
}

async function rerunSavedSearch(id, type) {
  if (type === "cause_list_text") {
    const data = await api(`/api/saved-searches/${id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setOutput("Saved Search Rerun", data, "causeList");
    return;
  }

  if (!state.sessionId) {
    await loadCaptchaSession();
  }

  const data = await api(`/api/saved-searches/${id}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: state.sessionId,
      captcha: refs.captchaInput.value.trim(),
    }),
  });
  setOutput("Saved Search Rerun", data, "caseStatus");
}

async function viewLatestSavedRun(id) {
  const data = await api(`/api/saved-searches/${id}/latest-run`);
  if (!data.latestRun) {
    clearOutput("savedDataPanel");
    return;
  }

  const kind = data.latestRun.sourceType.startsWith("cause_list") ? "causeList" : "caseStatus";
  setOutput("Saved Snapshot", data.latestRun.resultJson, kind);
}

async function deleteSavedSearch(id) {
  await api(`/api/saved-searches/${id}`, { method: "DELETE" });
  await loadSavedSearches();
}

async function loadSavedSearches() {
  const data = await api("/api/saved-searches");
  const items = data.items || [];
  const causeSearches = items.filter(isCauseSearch);
  const caseStatusSearches = items.filter((item) => !isCauseSearch(item));
  const snapshots = items.filter((item) => item.latestRun);
  const causeSnapshots = snapshots.filter(isCauseSnapshot);
  const caseStatusSnapshots = snapshots.filter((item) => !isCauseSnapshot(item));

  const selectedSearchType = refs.savedSearchTypeSelect.value || "cause";
  updateSavedSearchGroup(selectedSearchType);
  const searchItems = selectedSearchType === "caseStatus" ? caseStatusSearches : causeSearches;
  refs.savedSearchesList.innerHTML = searchItems.length
    ? searchItems.map(renderSavedSearchCard).join("")
    : emptyCollection(selectedSearchType === "caseStatus" ? "No case-status searches saved yet." : "No cause-list searches saved yet.");

  const selectedDataType = refs.savedDataTypeSelect.value || "cause";
  updateSavedDataGroup(selectedDataType);
  const dataItems = selectedDataType === "caseStatus" ? caseStatusSnapshots : causeSnapshots;
  refs.savedDataList.innerHTML = dataItems.length
    ? dataItems.map(renderSavedDataCard).join("")
    : emptyCollection(selectedDataType === "caseStatus" ? "No case-status snapshots saved yet." : "No cause-list snapshots saved yet.");
}

function setActivePanel(panelId) {
  refs.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === panelId));
  refs.panels.forEach((panel) => panel.classList.toggle("active", panel.id === panelId));
  clearOutput(panelId);
}

window.__rerunSavedSearch = async (id, type) => {
  try {
    await rerunSavedSearch(id, type);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not rerun saved search.";
    refs.caseStatusStatus.textContent = message;
    refs.causeStatus.textContent = message;
  }
};

window.__viewLatestSavedRun = async (id) => {
  try {
    await viewLatestSavedRun(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open snapshot.";
    refs.caseStatusStatus.textContent = message;
    refs.causeStatus.textContent = message;
  }
};

window.__deleteSavedSearch = async (id) => {
  try {
    await deleteSavedSearch(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete saved search.";
    refs.caseStatusStatus.textContent = message;
    refs.causeStatus.textContent = message;
  }
};

refs.tabs.forEach((tab) => tab.addEventListener("click", () => setActivePanel(tab.dataset.tab)));
refs.modeTabs.forEach((tab) => tab.addEventListener("click", () => setCaseMode(tab.dataset.mode)));
refs.benchSelect.addEventListener("change", () => void loadCaseTypes());
refs.savedSearchTypeSelect.addEventListener("change", () => void loadSavedSearches());
refs.savedDataTypeSelect.addEventListener("change", () => void loadSavedSearches());

refs.loadCaptchaBtn.addEventListener("click", async () => {
  try {
    await withBusy(refs.loadCaptchaBtn, "Loading Session", loadCaptchaSession, (message) => {
      refs.caseStatusStatus.textContent = message;
    });
  } catch {}
});

refs.refreshCaptchaBtn.addEventListener("click", async () => {
  try {
    await withBusy(refs.refreshCaptchaBtn, "Refreshing", async () => refreshCaptchaImage(), (message) => {
      refs.caseStatusStatus.textContent = message;
    });
  } catch {}
});

refs.causeSearchBtn.addEventListener("click", async () => {
  try {
    await withBusy(refs.causeSearchBtn, "Searching", searchCauseLists, (message) => {
      refs.causeStatus.textContent = message;
    });
  } catch {}
});

refs.causeSaveBtn.addEventListener("click", async () => {
  try {
    await withBusy(refs.causeSaveBtn, "Saving", saveCauseSearch, (message) => {
      refs.causeStatus.textContent = message;
    });
  } catch {}
});

refs.syncCauseListsBtn.addEventListener("click", async () => {
  try {
    await withBusy(refs.syncCauseListsBtn, "Syncing", runCauseListSync, (message) => {
      refs.syncStatusNote.textContent = message;
    });
  } catch {}
});

refs.caseStatusSearchBtn.addEventListener("click", async () => {
  try {
    await withBusy(refs.caseStatusSearchBtn, "Searching", runCaseStatusSearch, (message) => {
      refs.caseStatusStatus.textContent = message;
    });
  } catch {}
});

refs.caseStatusSaveBtn.addEventListener("click", async () => {
  try {
    await withBusy(refs.caseStatusSaveBtn, "Saving", saveCaseStatusSearch, (message) => {
      refs.caseStatusStatus.textContent = message;
    });
  } catch {}
});

(async function init() {
  refs.causeQuery.value = "UDAYNARAYAN";
  refs.causeLabel.value = "Track UDAYNARAYAN";
  refs.partyName.value = "UDAYNARAYAN";
  refs.advocateName.value = "UDAYNARAYAN BETAL";
  refs.advocateLabel.value = "Track UDAYNARAYAN BETAL";
  refs.partyYear.value = String(new Date().getFullYear());
  setCaseMode("advocate");
  clearOutput("causeListPanel");
  try {
    await loadBenches();
  } catch (error) {
    refs.caseStatusStatus.textContent = error instanceof Error ? error.message : "Could not load benches.";
  }
  await loadSavedSearches();
  await refreshSyncStatus();
})().catch((error) => {
  refs.resultMode.textContent = "Startup Error";
  refs.resultMeta.textContent = "Startup failed.";
  refs.resultsRaw.textContent = error instanceof Error ? error.message : "Startup failed.";
});
