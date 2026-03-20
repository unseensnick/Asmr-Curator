let imageBase64 = null,
    tags = [],
    dragSrcIdx = null;

const fileInput = document.getElementById("fileInput");
const uploadZone = document.getElementById("uploadZone");
const extractBtn = document.getElementById("extractBtn");
const extractStatus = document.getElementById("extractStatus");
const previewWrap = document.getElementById("previewWrap");
const titleInput = document.getElementById("titleInput");
const tagsArea = document.getElementById("tagsArea");
const tagInput = document.getElementById("tagInput");
const addTagBtn = document.getElementById("addTagBtn");
const suffixInput = document.getElementById("suffixInput");
const generateBtn = document.getElementById("generateBtn");
const debugToggle = document.getElementById("debugToggle");
const debugArrow = document.getElementById("debugArrow");
const debugBody = document.getElementById("debugBody");
const ocrRawText = document.getElementById("ocrRawText");
const imgModal = document.getElementById("imgModal");
const modalClose = document.getElementById("modalClose");
const modalImg = document.getElementById("modalImg");
const outputPlaceholderDash = document.getElementById("outputPlaceholderDash");
const outputResultDash = document.getElementById("outputResultDash");
const outputTextDash = document.getElementById("outputTextDash");
const copyBtnDash = document.getElementById("copyBtnDash");
const regenerateBtnDash = document.getElementById("regenerateBtnDash");
const outputPlaceholderPipe = document.getElementById("outputPlaceholderPipe");
const outputResultPipe = document.getElementById("outputResultPipe");
const outputTextPipe = document.getElementById("outputTextPipe");
const copyBtnPipe = document.getElementById("copyBtnPipe");
const regenerateBtnPipe = document.getElementById("regenerateBtnPipe");

// File handling
uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadZone.classList.add("drag-over");
});
uploadZone.addEventListener("dragleave", () =>
    uploadZone.classList.remove("drag-over"),
);
uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.classList.remove("drag-over");
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) handleFile(f);
});
fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
});
document.addEventListener("paste", (e) => {
    for (const item of e.clipboardData?.items || []) {
        if (item.type.startsWith("image/")) {
            const f = item.getAsFile();
            if (f) {
                handleFile(f);
                break;
            }
        }
    }
});

function clearImg() {
    imageBase64 = null;
    previewWrap.innerHTML = "";
    fileInput.value = "";
    extractBtn.disabled = true;
    extractStatus.innerHTML = "";
    debugToggle.style.display = "none";
    debugBody.style.display = "none";
    uploadZone.classList.remove("has-image");
}

function handleFile(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        imageBase64 = dataUrl.split(",")[1];
        uploadZone.classList.add("has-image");
        previewWrap.innerHTML = `
            <div class="preview-container">
                <img src="${dataUrl}" class="preview-img" id="previewThumb" alt="Screenshot">
                <div class="preview-actions">
                    <button class="preview-action-btn change" id="previewChangeBtn" title="Change image">↩</button>
                    <button class="preview-action-btn remove" id="previewRemoveBtn" title="Remove image">×</button>
                </div>
            </div>`;
        document
            .getElementById("previewThumb")
            .addEventListener("click", () => openModal(dataUrl));
        document
            .getElementById("previewRemoveBtn")
            .addEventListener("click", clearImg);
        document
            .getElementById("previewChangeBtn")
            .addEventListener("click", () => {
                clearImg();
                fileInput.click();
            });
        extractBtn.disabled = false;
    };
    reader.readAsDataURL(file);
}

function openModal(src) {
    modalImg.src = src;
    imgModal.classList.add("open");
    document.body.style.overflow = "hidden";
}
function closeModal() {
    imgModal.classList.remove("open");
    document.body.style.overflow = "";
}
modalClose.addEventListener("click", closeModal);
imgModal.addEventListener("click", (e) => {
    if (e.target === imgModal) closeModal();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
});

debugToggle.addEventListener("click", (e) => {
    if (e.target.closest("#debugCopyBtn")) return;
    const open = debugBody.style.display !== "none";
    debugBody.style.display = open ? "none" : "block";
    debugArrow.textContent = open ? "▶" : "▼";
});

document.getElementById("debugCopyBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const text = ocrRawText.textContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById("debugCopyBtn");
        const icon = btn.querySelector(".mi");
        icon.textContent = "check";
        btn.classList.add("copied");
        setTimeout(() => {
            icon.textContent = "content_copy";
            btn.classList.remove("copied");
        }, 2000);
    });
});

// ── Dictionary (SQLite via API) ───────────────────────────────
const API = ""; // same origin — empty prefix

// dict holds live data with IDs for deletes
let dict = {
    pills: [], // [{id, phrase}]
    synonyms: [], // [{id, from_word, to_word}]
    variants: [], // [{id, from_str, to_str}]
    splitFixes: [], // [{id, pattern, replacement}]
    _pillPhrases: [],
    _synMap: {},
    _varMap: {},
    _fixList: [],
};

async function apiGet(path) {
    const r = await fetch(API + path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
}
async function apiPost(path, body) {
    const r = await fetch(API + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
}
async function apiDelete(path) {
    const r = await fetch(API + path, { method: "DELETE" });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
}
async function apiPut(path, body) {
    const r = await fetch(API + path, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
}
async function apiPatch(path, body) {
    const r = await fetch(API + path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
}

async function loadDict() {
    const data = await apiGet("/api/dictionary");
    dict.pills = data._pills;
    dict.synonyms = data._synonyms;
    dict.variants = data._variants;
    dict.splitFixes = data._splitFixes;
    dict._pillPhrases = data._pills.map((p) => p.phrase);
    dict._synMap = data.synonyms;
    dict._varMap = data.variants;
    dict._fixList = data.splitFixes;
    renderAll();
}

// ── Dictionary Modal ──────────────────────────────────────────
const dictModal = document.getElementById("dictModal");
const openDictBtn = document.getElementById("openDictBtn");
const dictModalClose = document.getElementById("dictModalClose");

function openDictionary() {
    dictModal.classList.add("open");
    document.body.style.overflow = "hidden";
}
function closeDictionary() {
    dictModal.classList.remove("open");
    document.body.style.overflow = "";
}
openDictBtn.addEventListener("click", openDictionary);
dictModalClose.addEventListener("click", closeDictionary);
dictModal.addEventListener("click", (e) => {
    if (e.target === dictModal) closeDictionary();
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dictModal.classList.contains("open"))
        closeDictionary();
});

// Tabs
document.querySelectorAll(".dict-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
        document
            .querySelectorAll(".dict-tab")
            .forEach((t) => t.classList.remove("active"));
        document
            .querySelectorAll(".dict-pane")
            .forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        document
            .getElementById("pane-" + tab.dataset.pane)
            .classList.add("active");
    });
});

function updateBadge() {
    document.getElementById("badgePhrases").textContent =
        dict.pills.length + " phrases";
    document.getElementById("badgeMappings").textContent =
        dict.synonyms.length +
        dict.variants.length +
        dict.splitFixes.length +
        " mappings";
    document.getElementById("countPhrases").textContent = dict.pills.length;
    document.getElementById("countSynonyms").textContent = dict.synonyms.length;
    document.getElementById("countVariants").textContent = dict.variants.length;
    document.getElementById("countSplitfixes").textContent =
        dict.splitFixes.length;
}

// ── Render phrases ──
function renderPills() {
    const grid = document.getElementById("phraseGrid");
    grid.innerHTML = "";
    dict.pills.forEach((p) => {
        const el = document.createElement("span");
        el.className = "phrase-chip";
        el.innerHTML = `<span class="phrase-chip-label" title="Click to edit">${p.phrase}</span><span class="phrase-chip-del" title="Delete"><span class="mi">close</span></span>`;

        // Delete
        el.querySelector(".phrase-chip-del").addEventListener(
            "click",
            async (e) => {
                e.stopPropagation();
                await apiDelete(`/api/pills/${p.id}`);
                dict.pills = dict.pills.filter((x) => x.id !== p.id);
                dict._pillPhrases = dict.pills.map((x) => x.phrase);
                renderPills();
                updateBadge();
            },
        );

        // Edit — click the label text to edit inline
        const enterEdit = (e) => {
            e.stopPropagation();
            const inp = document.createElement("input");
            inp.className = "phrase-chip-inp";
            inp.value = p.phrase;
            el.innerHTML = "";
            el.appendChild(inp);

            const save = document.createElement("span");
            save.className = "phrase-chip-save";
            save.innerHTML = '<span class="mi">check</span>';
            el.appendChild(save);

            const cancel = document.createElement("span");
            cancel.className = "phrase-chip-cancel";
            cancel.innerHTML = '<span class="mi">close</span>';
            el.appendChild(cancel);

            inp.focus();
            inp.select();

            const doSave = async () => {
                const val = inp.value.trim();
                if (!val || val === p.phrase) {
                    renderPills();
                    return;
                }
                try {
                    const updated = await apiPatch(`/api/pills/${p.id}`, {
                        phrase: val,
                    });
                    const idx = dict.pills.findIndex((x) => x.id === p.id);
                    if (idx !== -1) dict.pills[idx] = updated;
                    dict._pillPhrases = dict.pills.map((x) => x.phrase);
                    renderPills();
                } catch (err) {
                    alert(err.message);
                    renderPills();
                }
            };

            save.addEventListener("click", doSave);
            cancel.addEventListener("click", () => renderPills());
            inp.addEventListener("keydown", (e) => {
                if (e.key === "Enter") doSave();
                if (e.key === "Escape") renderPills();
            });
        };

        el.querySelector(".phrase-chip-label").addEventListener(
            "click",
            enterEdit,
        );

        grid.appendChild(el);
    });
}

document.getElementById("pillAddBtn").addEventListener("click", async () => {
    const val = document.getElementById("pillAddInput").value.trim(); // preserve user casing — stored as-is
    if (!val) return;
    try {
        const row = await apiPost("/api/pills", {
            phrase: val,
        });
        dict.pills.push(row);
        dict._pillPhrases = dict.pills.map((x) => x.phrase);
        renderPills();
        updateBadge();
        document.getElementById("pillAddInput").value = "";
    } catch (e) {
        alert(e.message);
    }
});
document.getElementById("pillAddInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("pillAddBtn").click();
});

// ── Render synonyms ──
function renderSynonyms() {
    const list = document.getElementById("synonymsList");
    list.innerHTML = "";
    dict.synonyms.forEach((s) => {
        const row = document.createElement("div");
        row.className = "map-row";
        const toHtml =
            s.to_word === null
                ? '<span class="map-to-null">suppressed</span>'
                : s.to_word;
        row.innerHTML = `
            <div class="map-from-val map-val-editable" title="Click to edit">${s.from_word}</div>
            <div class="map-arr">→</div>
            <div class="map-to-val map-val-editable" title="Click to edit">${toHtml}</div>
            <div class="map-row-actions">
              <button class="map-row-del" title="Delete"><span class="mi">delete</span></button>
            </div>`;

        // Delete
        row.querySelector(".map-row-del").addEventListener(
            "click",
            async () => {
                await apiDelete(`/api/synonyms/${s.id}`);
                dict.synonyms = dict.synonyms.filter((x) => x.id !== s.id);
                dict._synMap = Object.fromEntries(
                    dict.synonyms.map((x) => [x.from_word, x.to_word]),
                );
                renderSynonyms();
                updateBadge();
            },
        );

        // Edit — clicking either value cell opens the inline editor
        const enterEdit = (focusTo = false) => {
            const isSuppressed = s.to_word === null;
            row.classList.add("is-editing");
            row.innerHTML = `
                <input class="map-edit-inp" id="seFrom" value="${s.from_word}" placeholder="OCR word">
                <div class="map-arr">→</div>
                <input class="map-edit-inp" id="seTo" value="${s.to_word ?? ""}" placeholder="Output tag" ${isSuppressed ? "disabled" : ""}>
                <div class="map-edit-controls">
                  <label class="suppress-toggle" title="Suppress — drop this word from output">
                    <input type="checkbox" id="seNull" ${isSuppressed ? "checked" : ""}>
                    <span class="suppress-toggle-pill">suppress</span>
                  </label>
                  <button class="map-row-save" title="Save"><span class="mi">check</span></button>
                  <button class="map-row-cancel" title="Cancel"><span class="mi">close</span></button>
                </div>`;
            const fromI = row.querySelector("#seFrom");
            const toI = row.querySelector("#seTo");
            const nullC = row.querySelector("#seNull");
            nullC.addEventListener("change", () => {
                toI.disabled = nullC.checked;
                if (nullC.checked) toI.value = "";
                else {
                    toI.focus();
                    toI.select();
                }
            });
            const doSave = async () => {
                const fw = fromI.value.trim().toLowerCase();
                const tw = nullC.checked ? null : toI.value.trim();
                if (!fw) return;
                try {
                    const updated = await apiPatch(`/api/synonyms/${s.id}`, {
                        from_word: fw,
                        to_word: tw,
                    });
                    const idx = dict.synonyms.findIndex((x) => x.id === s.id);
                    if (idx !== -1) dict.synonyms[idx] = updated;
                    dict._synMap = Object.fromEntries(
                        dict.synonyms.map((x) => [x.from_word, x.to_word]),
                    );
                    renderSynonyms();
                } catch (err) {
                    alert(err.message);
                    renderSynonyms();
                }
            };
            row.querySelector(".map-row-save").addEventListener(
                "click",
                doSave,
            );
            row.querySelector(".map-row-cancel").addEventListener("click", () =>
                renderSynonyms(),
            );
            row.querySelectorAll("input").forEach((inp) => {
                inp.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") doSave();
                    if (e.key === "Escape") renderSynonyms();
                });
            });
            if (focusTo && !isSuppressed) {
                toI.focus();
                toI.select();
            } else {
                fromI.focus();
                fromI.select();
            }
        };

        row.querySelector(".map-from-val").addEventListener("click", () =>
            enterEdit(false),
        );
        row.querySelector(".map-to-val").addEventListener("click", () =>
            enterEdit(true),
        );

        list.appendChild(row);
    });
}

document.getElementById("synAddBtn").addEventListener("click", async () => {
    const from_word = document
        .getElementById("synFromInput")
        .value.trim()
        .toLowerCase();
    const isNull = document.getElementById("synNullCheck").checked;
    const to_word = isNull
        ? null
        : document.getElementById("synToInput").value.trim();
    if (!from_word || (!isNull && !to_word)) return;
    try {
        const row = await apiPost("/api/synonyms", {
            from_word,
            to_word,
        });
        dict.synonyms.push(row);
        dict._synMap = Object.fromEntries(
            dict.synonyms.map((x) => [x.from_word, x.to_word]),
        );
        renderSynonyms();
        updateBadge();
        document.getElementById("synFromInput").value = "";
        document.getElementById("synToInput").value = "";
        document.getElementById("synNullCheck").checked = false;
        document.getElementById("synToInput").disabled = false;
    } catch (e) {
        alert(e.message);
    }
});
document.getElementById("synNullCheck").addEventListener("change", (e) => {
    document.getElementById("synToInput").disabled = e.target.checked;
    if (e.target.checked) document.getElementById("synToInput").value = "";
});

// ── Render variants ──
function renderVariants() {
    const list = document.getElementById("variantsList");
    list.innerHTML = "";
    dict.variants.forEach((v) => {
        const row = document.createElement("div");
        row.className = "map-row";
        row.innerHTML = `
            <div class="map-from-val map-val-editable" title="Click to edit">${v.from_str}</div>
            <div class="map-arr">→</div>
            <div class="map-to-val map-val-editable" title="Click to edit">${v.to_str}</div>
            <div class="map-row-actions">
              <button class="map-row-del" title="Delete"><span class="mi">delete</span></button>
            </div>`;

        // Delete
        row.querySelector(".map-row-del").addEventListener(
            "click",
            async () => {
                await apiDelete(`/api/variants/${v.id}`);
                dict.variants = dict.variants.filter((x) => x.id !== v.id);
                dict._varMap = Object.fromEntries(
                    dict.variants.map((x) => [x.from_str, x.to_str]),
                );
                renderVariants();
                updateBadge();
            },
        );

        // Edit — clicking either value cell opens the inline editor
        const enterEdit = (focusTo = false) => {
            row.classList.add("is-editing");
            row.innerHTML = `
                <input class="map-edit-inp" id="veFrom" value="${v.from_str}" placeholder="OCR string">
                <div class="map-arr">→</div>
                <input class="map-edit-inp" id="veTo" value="${v.to_str}" placeholder="Display name">
                <div class="map-edit-controls">
                  <button class="map-row-save" title="Save"><span class="mi">check</span></button>
                  <button class="map-row-cancel" title="Cancel"><span class="mi">close</span></button>
                </div>`;
            const fromI = row.querySelector("#veFrom");
            const toI = row.querySelector("#veTo");
            const doSave = async () => {
                const fs = fromI.value.trim().toLowerCase();
                const ts = toI.value.trim();
                if (!fs || !ts) return;
                try {
                    const updated = await apiPatch(`/api/variants/${v.id}`, {
                        from_str: fs,
                        to_str: ts,
                    });
                    const idx = dict.variants.findIndex((x) => x.id === v.id);
                    if (idx !== -1) dict.variants[idx] = updated;
                    dict._varMap = Object.fromEntries(
                        dict.variants.map((x) => [x.from_str, x.to_str]),
                    );
                    renderVariants();
                } catch (err) {
                    alert(err.message);
                    renderVariants();
                }
            };
            row.querySelectorAll("input").forEach((inp) => {
                inp.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") doSave();
                    if (e.key === "Escape") renderVariants();
                });
            });
            row.querySelector(".map-row-save").addEventListener(
                "click",
                doSave,
            );
            row.querySelector(".map-row-cancel").addEventListener("click", () =>
                renderVariants(),
            );
            if (focusTo) {
                toI.focus();
                toI.select();
            } else {
                fromI.focus();
                fromI.select();
            }
        };

        row.querySelector(".map-from-val").addEventListener("click", () =>
            enterEdit(false),
        );
        row.querySelector(".map-to-val").addEventListener("click", () =>
            enterEdit(true),
        );

        list.appendChild(row);
    });
}

document.getElementById("varAddBtn").addEventListener("click", async () => {
    const from_str = document
        .getElementById("varFromInput")
        .value.trim()
        .toLowerCase();
    const to_str = document.getElementById("varToInput").value.trim();
    if (!from_str || !to_str) return;
    try {
        const row = await apiPost("/api/variants", {
            from_str,
            to_str,
        });
        dict.variants.push(row);
        dict._varMap = Object.fromEntries(
            dict.variants.map((x) => [x.from_str, x.to_str]),
        );
        renderVariants();
        updateBadge();
        document.getElementById("varFromInput").value = "";
        document.getElementById("varToInput").value = "";
    } catch (e) {
        alert(e.message);
    }
});
document.getElementById("varFromInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("varAddBtn").click();
});
document.getElementById("varToInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("varAddBtn").click();
});

// ── Render splitFixes ──
function renderSplitFixes() {
    const list = document.getElementById("splitfixesList");
    list.innerHTML = "";
    dict.splitFixes.forEach((f) => {
        const row = document.createElement("div");
        row.className = "map-row";
        row.innerHTML = `
            <div class="map-from-val map-val-editable" title="Click to edit" style="font-size:10px;font-style:italic">${f.pattern.replace(/</g, "&lt;")}</div>
            <div class="map-arr">→</div>
            <div class="map-to-val map-val-editable" title="Click to edit">${f.replacement}</div>
            <div class="map-row-actions">
              <button class="map-row-del" title="Delete"><span class="mi">delete</span></button>
            </div>`;

        // Delete
        row.querySelector(".map-row-del").addEventListener(
            "click",
            async () => {
                await apiDelete(`/api/splitfixes/${f.id}`);
                dict.splitFixes = dict.splitFixes.filter((x) => x.id !== f.id);
                dict._fixList = dict.splitFixes.map((x) => [
                    x.pattern,
                    x.replacement,
                ]);
                renderSplitFixes();
                updateBadge();
            },
        );

        // Edit — clicking either value cell opens the inline editor
        const enterEdit = (focusTo = false) => {
            row.classList.add("is-editing");
            row.innerHTML = `
                <input class="map-edit-inp" id="sfFrom" value="${f.pattern.replace(/"/g, "&quot;")}" placeholder="Regex pattern" style="font-size:10px;font-style:italic">
                <div class="map-arr">→</div>
                <input class="map-edit-inp" id="sfTo" value="${f.replacement}" placeholder="Replacement">
                <div class="map-edit-controls">
                  <button class="map-row-save" title="Save"><span class="mi">check</span></button>
                  <button class="map-row-cancel" title="Cancel"><span class="mi">close</span></button>
                </div>`;
            const patI = row.querySelector("#sfFrom");
            const repI = row.querySelector("#sfTo");
            const doSave = async () => {
                const pat = patI.value.trim();
                const rep = repI.value.trim();
                if (!pat || !rep) return;
                try {
                    new RegExp(pat, "gi");
                } catch {
                    alert("Invalid regex pattern");
                    return;
                }
                try {
                    const updated = await apiPatch(`/api/splitfixes/${f.id}`, {
                        pattern: pat,
                        replacement: rep,
                    });
                    const idx = dict.splitFixes.findIndex((x) => x.id === f.id);
                    if (idx !== -1) dict.splitFixes[idx] = updated;
                    dict._fixList = dict.splitFixes.map((x) => [
                        x.pattern,
                        x.replacement,
                    ]);
                    renderSplitFixes();
                } catch (err) {
                    alert(err.message);
                    renderSplitFixes();
                }
            };
            row.querySelectorAll("input").forEach((inp) => {
                inp.addEventListener("keydown", (e) => {
                    if (e.key === "Enter") doSave();
                    if (e.key === "Escape") renderSplitFixes();
                });
            });
            row.querySelector(".map-row-save").addEventListener(
                "click",
                doSave,
            );
            row.querySelector(".map-row-cancel").addEventListener("click", () =>
                renderSplitFixes(),
            );
            if (focusTo) {
                repI.focus();
                repI.select();
            } else {
                patI.focus();
                patI.select();
            }
        };

        row.querySelector(".map-from-val").addEventListener("click", () =>
            enterEdit(false),
        );
        row.querySelector(".map-to-val").addEventListener("click", () =>
            enterEdit(true),
        );

        list.appendChild(row);
    });
}

document.getElementById("sfAddBtn").addEventListener("click", async () => {
    const pattern = document.getElementById("sfPatInput").value.trim();
    const replacement = document.getElementById("sfRepInput").value.trim();
    if (!pattern || !replacement) return;
    try {
        new RegExp(pattern, "gi");
    } catch {
        alert("Invalid regex pattern");
        return;
    }
    try {
        const row = await apiPost("/api/splitfixes", {
            pattern,
            replacement,
        });
        dict.splitFixes.push(row);
        dict._fixList = dict.splitFixes.map((x) => [x.pattern, x.replacement]);
        renderSplitFixes();
        updateBadge();
        document.getElementById("sfPatInput").value = "";
        document.getElementById("sfRepInput").value = "";
    } catch (e) {
        alert(e.message);
    }
});
document.getElementById("sfPatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("sfAddBtn").click();
});
document.getElementById("sfRepInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("sfAddBtn").click();
});

// ── Export ──
document.getElementById("dictExportBtn").addEventListener("click", async () => {
    const data = await apiGet("/api/dictionary");
    const blob = new Blob(
        [
            JSON.stringify(
                {
                    pills: data.pills,
                    synonyms: data.synonyms,
                    variants: data.variants,
                    splitFixes: data.splitFixes,
                },
                null,
                2,
            ),
        ],
        { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "asmr-tag-dictionary.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
});

// ── Import ──
document.getElementById("dictImportBtn").addEventListener("click", () => {
    document.getElementById("dictImportFile").click();
});
document.getElementById("dictImportFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
        try {
            const imported = JSON.parse(ev.target.result);
            if (
                !imported.pills ||
                !imported.synonyms ||
                !imported.variants ||
                !imported.splitFixes
            )
                throw new Error("Missing required keys");
            await apiPut("/api/dictionary", imported);
            await loadDict();
            alert("Dictionary imported successfully.");
        } catch (err) {
            alert("Import failed: " + err.message);
        }
    };
    reader.readAsText(file);
    e.target.value = "";
});

// ── Reset ──
document.getElementById("dictResetBtn").addEventListener("click", async () => {
    if (
        !confirm(
            "Reset dictionary to built-in defaults? All custom entries will be lost.",
        )
    )
        return;
    await apiPost("/api/dictionary/reset", {});
    await loadDict();
});

function renderAll() {
    renderPills();
    renderSynonyms();
    renderVariants();
    renderSplitFixes();
    updateBadge();
}

// Boot: load from API
loadDict();

// ── Test pane ─────────────────────────────────────────────────────────────────
const HOW_META = {
    paren: {
        label: "( )",
        cls: "how-paren",
        tip: "Extracted from parentheses in the title",
    },
    phrase: {
        label: "phrase",
        cls: "how-phrase",
        tip: "Matched a known phrase from the dictionary",
    },
    variant: {
        label: "variant",
        cls: "how-variant",
        tip: "Normalised via a Variants mapping",
    },
    synonym: {
        label: "synonym",
        cls: "how-synonym",
        tip: "Replaced via a Synonyms mapping",
    },
    suppressed: {
        label: "suppress",
        cls: "how-suppress",
        tip: "Suppressed by a Synonyms null mapping",
    },
    titlecase: {
        label: "fallback",
        cls: "how-fallback",
        tip: "Unknown token — title-cased as fallback",
    },
    special: {
        label: "SFW/NSFW",
        cls: "how-special",
        tip: "Matched the SFW/NSFW special case",
    },
    unknown: {
        label: "unknown",
        cls: "how-unknown",
        tip: "Not in dictionary — passed through",
    },
};

function escHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function renderTestOutput(result) {
    const out = document.getElementById("testOutput");
    const d = result._debug;

    // Tag chips
    let chipsHtml = result.tags
        .map((tag) => {
            const td = d.tagDebug.find((x) => x.display === tag);
            const how = td
                ? td.source === "paren"
                    ? "paren"
                    : td.how
                : "titlecase";
            const meta = HOW_META[how] || HOW_META.titlecase;
            return `<span class="test-chip" title="${meta.tip}">
            ${escHtml(tag)}<span class="test-chip-how ${meta.cls}">${meta.label}</span>
        </span>`;
        })
        .join("");

    const suppressed = d.tagDebug.filter((x) => x.how === "suppressed");
    if (suppressed.length) {
        chipsHtml += suppressed
            .map(
                (x) =>
                    `<span class="test-chip test-chip-suppressed" title="Suppressed by synonyms mapping">
                ${escHtml(x.original)}<span class="test-chip-how how-suppress">suppress</span>
            </span>`,
            )
            .join("");
    }

    // Blob diff
    const blobSection = d.blobFixApplied
        ? `<div class="test-section">
            <div class="test-section-title"><span class="mi" style="font-size:13px;vertical-align:-2px">content_cut</span> Split fix applied to pill blob</div>
            <div class="test-diff"><span class="test-diff-before">${escHtml(d.blobBefore)}</span><span class="test-diff-arrow">→</span><span class="test-diff-after">${escHtml(d.blobFixed)}</span></div>
           </div>`
        : "";

    // Paren fix diffs
    const parenFixes = d.parenDebug.filter((x) => x.fixApplied);
    const parenFixSection = parenFixes.length
        ? `<div class="test-section">
            <div class="test-section-title"><span class="mi" style="font-size:13px;vertical-align:-2px">content_cut</span> Split fixes applied to paren tags</div>
            ${parenFixes.map((x) => `<div class="test-diff"><span class="test-diff-before">${escHtml(x.raw)}</span><span class="test-diff-arrow">→</span><span class="test-diff-after">${escHtml(x.fixed)}</span></div>`).join("")}
           </div>`
        : "";

    // Unknown tokens
    const unknownSection = d.unknownTokens.length
        ? `<div class="test-section test-section-warn">
            <div class="test-section-title"><span class="mi" style="font-size:13px;vertical-align:-2px">warning</span> Unrecognised tokens — add a rule to fix these</div>
            <div class="test-unknown-list">
                ${d.unknownTokens
                    .map(
                        (t) => `
                <div class="test-unknown-row">
                    <span class="test-unknown-token">${escHtml(t)}</span>
                    <button class="test-qf-btn" data-token="${escHtml(t)}" data-action="splitfix"><span class="mi">content_cut</span> split fix</button>
                    <button class="test-qf-btn" data-token="${escHtml(t)}" data-action="variant"><span class="mi">auto_fix_high</span> variant</button>
                    <button class="test-qf-btn" data-token="${escHtml(t)}" data-action="phrase"><span class="mi">label</span> phrase</button>
                </div>`,
                    )
                    .join("")}
            </div>
           </div>`
        : "";

    // Remainder
    const remSection = d.remainderAfterMatch.trim()
        ? `<div class="test-section test-section-muted">
            <div class="test-section-title">Unmatched remainder after greedy pill scan</div>
            <code class="test-rem">${escHtml(d.remainderAfterMatch)}</code>
           </div>`
        : "";

    out.innerHTML = `
        <div class="test-section">
            <div class="test-section-title">Title extracted</div>
            <div class="test-title-val">${escHtml(result.title) || "<em>none</em>"}</div>
        </div>
        <div class="test-section">
            <div class="test-section-title">Final tags (${result.tags.length})</div>
            <div class="test-chips">${chipsHtml || '<em class="test-empty-inline">no tags found</em>'}</div>
        </div>
        ${blobSection}${parenFixSection}${unknownSection}${remSection}`;

    // Quick-fix buttons — jump to the right tab and pre-fill the add form
    out.querySelectorAll(".test-qf-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const token = btn.dataset.token;
            const action = btn.dataset.action;
            if (action === "splitfix") {
                document
                    .querySelector('.dict-tab[data-pane="splitfixes"]')
                    .click();
                const pat = document.getElementById("sfPatInput");
                pat.value = token.replace(/([.*+?^${}()|[\]\\])/g, "\\$&");
                document.getElementById("sfRepInput").focus();
            } else if (action === "variant") {
                document
                    .querySelector('.dict-tab[data-pane="variants"]')
                    .click();
                const from = document.getElementById("varFromInput");
                from.value = token;
                document.getElementById("varToInput").focus();
            } else if (action === "phrase") {
                document
                    .querySelector('.dict-tab[data-pane="phrases"]')
                    .click();
                const inp = document.getElementById("pillAddInput");
                inp.value = token;
                inp.focus();
            }
            btn.closest(".test-unknown-row").style.opacity = "0.45";
        });
    });
}

document.getElementById("testRunBtn").addEventListener("click", () => {
    const raw = document.getElementById("testOcrInput").value;
    if (!raw.trim()) return;
    const result = parseOcrText(raw, true);
    renderTestOutput(result);
});

document.getElementById("testOcrInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
        document.getElementById("testRunBtn").click();
});

// Parser

function toTitleCase(str) {
    const minors = new Set([
        "a",
        "an",
        "the",
        "and",
        "but",
        "or",
        "for",
        "nor",
        "on",
        "at",
        "to",
        "by",
        "in",
        "of",
        "up",
        "as",
        "so",
        "yet",
    ]);
    return str
        .trim()
        .split(" ")
        .map((w, i) => {
            const l = w.toLowerCase();
            return i === 0 || !minors.has(l)
                ? l.charAt(0).toUpperCase() + l.slice(1)
                : l;
        })
        .join(" ");
}

// Build compiled splitFixes once per parse (avoids re-compiling per token)
function compileSplitFixes() {
    return dict._fixList.map(([pat, rep]) => [
        new RegExp("\\b" + pat + "\\b", "gi"),
        rep,
    ]);
}

// Apply all splitFixes to a string
function applySplitFixes(str, fixes) {
    let s = str;
    for (const [rx, rep] of fixes) s = s.replace(rx, rep);
    return s.replace(/\s+/g, " ").trim();
}

function parseOcrText(raw, debug = false) {
    // Normalise curly/smart quotes to straight quotes before any matching
    const flat = raw
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/\n+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const compiledFixes = compileSplitFixes();
    const synonyms = dict._synMap;
    const variants = dict._varMap;

    const pillDisplayMap = {};
    for (const p of dict._pillPhrases) {
        pillDisplayMap[p.toLowerCase()] = p;
    }

    // ── Paren tags ────────────────────────────────────────────────────────
    const parenTags = [];
    const parenDebug = [];
    const rx = /\(([^)]{2,80})\)/g;
    let m;
    while ((m = rx.exec(flat)) !== null) {
        const rawInner = m[1].trim();
        const fixed = applySplitFixes(rawInner, compiledFixes);
        if (/^\d+\s*(days?|hours?|ago)/i.test(fixed) || /^[;:,.]/.test(fixed))
            continue;
        parenTags.push(fixed);
        if (debug)
            parenDebug.push({
                raw: rawInner,
                fixed,
                fixApplied: fixed !== rawInner,
            });
    }

    const fp = flat.indexOf("(");
    const coreTitle = (fp > 0 ? flat.slice(0, fp) : flat.slice(0, 120))
        .trim()
        .replace(/[-–\s]+$/, "")
        .trim();

    // ── Pill blob ─────────────────────────────────────────────────────────
    const soIdx = flat.search(
        /happy listening|feedback as always|much appreciated/i,
    );
    const after = soIdx > -1 ? flat.slice(soIdx) : "";
    const tailM = after.match(
        /(?:happy listening[^a-z]*|much appreciated[^a-z]*)(.*)/i,
    );
    const pillRaw = tailM ? tailM[1].trim() : "";
    const pillTokens = pillRaw
        .split(/\s+/)
        .map((t) => t.replace(/[^a-zA-Z\s\-']/g, "").trim())
        .filter((t) => t.length >= 2);

    const blobBefore = pillTokens.join(" ").toLowerCase();
    let rem = applySplitFixes(blobBefore, compiledFixes);
    const blobFixed = rem;

    const foundPills = [];
    const pillDebug = [];
    // Sort longest-first; use word-boundary lookarounds so "cuddles" won't
    // match inside "carcuddles" and leave a spurious "car" token behind.
    const knownPillsSorted = [...dict._pillPhrases].sort(
        (a, b) => b.length - a.length,
    );
    for (const p of knownPillsSorted) {
        const pLow = p.toLowerCase();
        const pillRx = new RegExp(
            "(?<![a-z])" +
                pLow.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
                "(?![a-z])",
            "i",
        );
        if (pillRx.test(rem)) {
            foundPills.push(pLow);
            if (debug)
                pillDebug.push({ token: pLow, how: "phrase", display: p });
            rem = rem.replace(pillRx, "").replace(/\s+/g, " ").trim();
        }
    }
    const unknownTokens = [];
    rem.split(/\s+/).forEach((t) => {
        if (t.length >= 3 && t.length <= 30 && /^[a-z]/.test(t)) {
            foundPills.push(t);
            unknownTokens.push(t);
            if (debug) pillDebug.push({ token: t, how: "unknown" });
        }
    });

    // ── Normalize ─────────────────────────────────────────────────────────
    const normalize = (t) => {
        const k = t.toLowerCase().trim();
        if (k in variants) return variants[k];
        if (k in synonyms) return synonyms[k];
        if (k in pillDisplayMap) return pillDisplayMap[k];
        if (/^(sfw|nsfw)$/i.test(t)) return t.toUpperCase();
        return toTitleCase(t);
    };

    const normalizeHow = (t) => {
        const k = t.toLowerCase().trim();
        if (k in variants) return "variant";
        if (k in synonyms)
            return synonyms[k] === null ? "suppressed" : "synonym";
        if (k in pillDisplayMap) return "phrase";
        if (/^(sfw|nsfw)$/i.test(t)) return "special";
        return "titlecase";
    };

    const seen = new Set();
    const finalTags = [];
    const tagDebug = [];
    for (const t of [...parenTags, ...foundPills]) {
        const n = normalize(t);
        if (n === null) {
            if (debug)
                tagDebug.push({
                    display: null,
                    how: "suppressed",
                    source: parenTags.includes(t) ? "paren" : "pill",
                    original: t,
                });
            continue;
        }
        const k = n.toLowerCase();
        if (!seen.has(k)) {
            seen.add(k);
            finalTags.push(n);
            if (debug)
                tagDebug.push({
                    display: n,
                    how: normalizeHow(t),
                    source: parenTags.includes(t) ? "paren" : "pill",
                    original: t,
                });
        }
    }

    if (debug) {
        return {
            title: coreTitle,
            tags: finalTags,
            _parenTags: parenTags,
            _pillTags: foundPills,
            _debug: {
                blobBefore,
                blobFixed,
                blobFixApplied: blobBefore !== blobFixed,
                parenDebug,
                pillDebug,
                tagDebug,
                unknownTokens,
                remainderAfterMatch: rem,
            },
        };
    }

    return {
        title: coreTitle,
        tags: finalTags,
        _parenTags: parenTags,
        _pillTags: foundPills,
    };
}

// OCR
extractBtn.addEventListener("click", async () => {
    if (!imageBase64) return;
    extractBtn.disabled = true;
    extractStatus.innerHTML = `<div class="spinner"></div> Running OCR...`;
    try {
        const result = await Tesseract.recognize(
            `data:image/png;base64,${imageBase64}`,
            "eng",
            {
                logger: (m) => {
                    if (m.status === "recognizing text")
                        extractStatus.innerHTML = `<div class="spinner"></div> Reading text... ${Math.round((m.progress || 0) * 100)}%`;
                },
            },
        );
        const raw = result.data.text;
        const parsed = parseOcrText(raw);
        ocrRawText.innerHTML =
            '<b style="color:var(--accent)">Paren tags:</b> ' +
            (parsed._parenTags.join(", ") || "(none)") +
            '\n<b style="color:var(--accent)">Pill tags:</b>  ' +
            (parsed._pillTags.join(", ") || "(none)") +
            '\n\n<b style="color:var(--accent)">Raw OCR:</b>\n' +
            raw.replace(/</g, "&lt;");
        debugToggle.style.display = "flex";
        titleInput.value = parsed.title || "";
        tags = parsed.tags || [];
        renderTags();
        extractStatus.innerHTML = parsed.title
            ? `<span class="success-text">✓ Done — review and adjust below</span>`
            : `<span style="color:var(--accent)">⚠ No title found — fill manually</span>`;
    } catch (err) {
        extractStatus.innerHTML = `<span class="error-text">✗ OCR failed. Fill manually.</span>`;
    } finally {
        extractBtn.disabled = false;
    }
});

// Tags
function renderTags() {
    tagsArea.innerHTML = "";
    tags.forEach((tag, i) => {
        const el = document.createElement("div");
        el.className = "tag";
        el.draggable = true;
        el.dataset.i = i;
        el.innerHTML = `<span class="drag-handle">⠿</span><span class="tag-label">${tag}</span><span class="tag-remove" data-i="${i}">×</span>`;
        el.addEventListener("dragstart", (e) => {
            dragSrcIdx = i;
            setTimeout(() => el.classList.add("dragging"), 0);
            e.dataTransfer.effectAllowed = "move";
            tagsArea.classList.add("drag-active");
        });
        el.addEventListener("dragend", () => {
            el.classList.remove("dragging");
            tagsArea.classList.remove("drag-active");
            tagsArea
                .querySelectorAll(".tag")
                .forEach((t) => t.classList.remove("drop-target"));
        });
        el.addEventListener("dragover", (e) => {
            e.preventDefault();
            tagsArea
                .querySelectorAll(".tag")
                .forEach((t) => t.classList.remove("drop-target"));
            if (i !== dragSrcIdx) el.classList.add("drop-target");
        });
        el.addEventListener("drop", (e) => {
            e.preventDefault();
            if (dragSrcIdx === null || dragSrcIdx === i) return;
            const moved = tags.splice(dragSrcIdx, 1)[0];
            tags.splice(i, 0, moved);
            dragSrcIdx = null;
            renderTags();
        });
        el.querySelector(".tag-remove").addEventListener("click", () => {
            tags.splice(i, 1);
            renderTags();
        });
        tagsArea.appendChild(el);
    });
}

function addTag() {
    const val = tagInput.value.trim();
    if (!val) return;
    // Use the same normalize() logic as the parser:
    // check variants → synonyms → pill display map → SFW/NSFW → toTitleCase
    // but if the user typed mixed/upper case that doesn't match any dictionary
    // entry, preserve their casing exactly rather than forcing title-case.
    const k = val.toLowerCase();
    let display;
    if (k in dict._varMap) display = dict._varMap[k];
    else if (k in dict._synMap) display = dict._synMap[k] ?? val;
    else {
        const pillMatch = dict._pillPhrases.find((p) => p.toLowerCase() === k);
        if (pillMatch) display = pillMatch;
        else if (/^(sfw|nsfw)$/i.test(val)) display = val.toUpperCase();
        else display = val; // keep exactly as typed
    }
    if (!display) display = val; // synonym was null — keep the input
    if (!tags.map((t) => t.toLowerCase()).includes(display.toLowerCase())) {
        tags.push(display);
        renderTags();
    }
    tagInput.value = "";
    tagInput.focus();
}
addTagBtn.addEventListener("click", addTag);
tagInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        addTag();
    }
});

// Generate
function generate() {
    const title = titleInput.value.trim();
    if (!title) {
        titleInput.focus();
        titleInput.style.borderColor = "var(--danger)";
        setTimeout(() => (titleInput.style.borderColor = ""), 1200);
        return;
    }
    const suffix = suffixInput.value.trim() || "F4A";
    outputTextDash.textContent = [title, ...tags, suffix].join(" - ") + "";
    outputPlaceholderDash.style.display = "none";
    outputResultDash.style.display = "block";
    outputTextPipe.textContent = [title, ...tags, suffix].join(" | ") + "";
    outputPlaceholderPipe.style.display = "none";
    outputResultPipe.style.display = "block";
}
generateBtn.addEventListener("click", generate);
regenerateBtnDash.addEventListener("click", generate);
regenerateBtnPipe.addEventListener("click", generate);

function makeCopyHandler(btn, getText) {
    btn.addEventListener("click", () => {
        navigator.clipboard.writeText(getText()).then(() => {
            const orig = btn.innerHTML;
            btn.innerHTML =
                '<span class="mi" style="font-size:14px">check</span> Copied!';
            btn.style.background = "rgba(52,211,153,0.15)";
            btn.style.borderColor = "rgba(52,211,153,0.4)";
            btn.style.color = "var(--success)";
            setTimeout(() => {
                btn.innerHTML = orig;
                btn.style.background = "";
                btn.style.borderColor = "";
                btn.style.color = "";
            }, 2000);
        });
    });
}
makeCopyHandler(copyBtnDash, () => outputTextDash.textContent);
makeCopyHandler(copyBtnPipe, () => outputTextPipe.textContent);

// ── File Browser & Rename (recursive search) ────────────────
let fbAllFiles = []; // full list from server
let fbFiltered = []; // after search filter
let fbSelectedPath = null;
let fbSelectedName = null;
let renameSep = "dash";
let fbSearchTimer = null;

const fbList = document.getElementById("fbList");
const fbSearch = document.getElementById("fbSearch");
const fbCount = document.getElementById("fbCount");
const fbRefreshBtn = document.getElementById("fbRefreshBtn");
const fbError = document.getElementById("fbError");
const renameFileLoaded = document.getElementById("renameFileLoaded");
const renameFileName = document.getElementById("renameFileName");
const renameFileMeta = document.getElementById("renameFileMeta");
const renameClearBtn = document.getElementById("renameClearBtn");
const renameBtn = document.getElementById("renameBtn");
const renamePreview = document.getElementById("renamePreview");

function showFbError(msg) {
    fbError.textContent = msg;
    fbError.style.display = msg ? "block" : "none";
}

async function fbLoadAll() {
    fbList.innerHTML =
        '<div class="fb-loading"><div class="spinner"></div> Scanning all folders…</div>';
    fbCount.textContent = "";
    showFbError("");
    try {
        const q = fbSearch.value.trim();
        const url =
            "/api/files/search" + (q ? "?q=" + encodeURIComponent(q) : "");
        const data = await (await fetch(url)).json();
        if (data.detail) throw new Error(data.detail);
        fbAllFiles = data.files;
        fbRender(fbAllFiles);
    } catch (e) {
        showFbError(
            "Could not load files: " +
                e.message +
                " — check AUDIO_ROOT mount in devcontainer.json / docker-compose.yml",
        );
        fbList.innerHTML = '<div class="fb-empty">No files found</div>';
        fbCount.textContent = "";
    }
}

function fbRender(files) {
    fbCount.textContent =
        files.length + " file" + (files.length !== 1 ? "s" : "");
    if (!files.length) {
        fbList.innerHTML = '<div class="fb-empty">No matching files</div>';
        return;
    }
    fbList.innerHTML = "";
    files.forEach((file) => {
        const el = document.createElement("div");
        el.className = "fb-entry";
        if (file.path === fbSelectedPath) el.classList.add("selected");
        const icon = [
            ".mp3",
            ".wav",
            ".flac",
            ".aac",
            ".ogg",
            ".m4a",
            ".wma",
        ].includes(file.ext)
            ? "audio_file"
            : [".mp4", ".mov", ".avi", ".mkv", ".webm"].includes(file.ext)
              ? "video_file"
              : "insert_drive_file";
        el.innerHTML = `
            <span class="mi">${icon}</span>
            <div class="fb-entry-info">
                <div class="fb-entry-name">${file.name}</div>
                ${file.folder ? `<div class="fb-entry-folder">${file.folder}</div>` : ""}
            </div>`;
        el.addEventListener("click", () => {
            fbList
                .querySelectorAll(".fb-entry")
                .forEach((e) => e.classList.remove("selected"));
            el.classList.add("selected");
            fbSelectFile(file);
        });
        fbList.appendChild(el);
    });
}

function fbSelectFile(file) {
    fbSelectedPath = file.path;
    fbSelectedName = file.name;
    renameFileName.textContent = file.name;
    renameFileMeta.textContent = file.folder
        ? file.folder + "/" + file.name
        : file.name;
    renameFileLoaded.style.display = "block";
    updateRenamePreview();
}

// Debounced live search
fbSearch.addEventListener("input", () => {
    clearTimeout(fbSearchTimer);
    fbSearchTimer = setTimeout(fbLoadAll, 300);
});

fbRefreshBtn.addEventListener("click", fbLoadAll);

function getExt(name) {
    const m = name.match(/(\.[^.]+)$/);
    return m ? m[1] : "";
}

function getNewName() {
    const text =
        renameSep === "dash"
            ? outputTextDash.textContent.trim()
            : outputTextPipe.textContent.trim();
    if (!text || !fbSelectedName) return null;
    return text + getExt(fbSelectedName);
}

const filenameLengthInfo = document.getElementById("filenameLengthInfo");
const MAX_BYTES = 255;

function getByteLength(str) {
    return new TextEncoder().encode(str).length;
}

function updateRenamePreview() {
    const newName = getNewName();
    if (!newName) {
        renamePreview.innerHTML = "Generate a filename above first";
        filenameLengthInfo.textContent = "";
        filenameLengthInfo.className = "filename-length";
        renameBtn.disabled = true;
        return;
    }
    const bytes = getByteLength(newName);
    const over = bytes > MAX_BYTES;
    const warn = bytes > 200 && !over;
    renamePreview.innerHTML = `→ <span style="color:var(--success)">${newName}</span>`;
    filenameLengthInfo.textContent = `${bytes} / ${MAX_BYTES} bytes${over ? " — too long, remove some tags" : warn ? " — approaching limit" : ""}`;
    filenameLengthInfo.className =
        "filename-length" + (over ? " over" : warn ? " warn" : "");
    renameBtn.disabled = over;
}

renameClearBtn.addEventListener("click", () => {
    fbSelectedPath = null;
    fbSelectedName = null;
    renameFileLoaded.style.display = "none";
    renamePreview.innerHTML = "Generate a filename above first";
    renameBtn.disabled = true;
    fbList
        .querySelectorAll(".fb-entry")
        .forEach((e) => e.classList.remove("selected"));
});

document.querySelectorAll(".sep-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        renameSep = btn.dataset.sep;
        document
            .querySelectorAll(".sep-btn")
            .forEach((b) => b.classList.toggle("active", b === btn));
        updateRenamePreview();
    });
});

renameBtn.addEventListener("click", async () => {
    const newName = getNewName();
    if (!newName || !fbSelectedPath) return;
    showFbError("");
    try {
        const res = await fetch("/api/rename", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                path: fbSelectedPath,
                new_name: newName,
            }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || res.statusText);

        // Update selection to renamed file
        fbSelectedPath = data.path;
        fbSelectedName = data.new_name;
        renameFileName.textContent = data.new_name;

        // Refresh list and re-highlight
        await fbLoadAll();
        const match = fbList.querySelector(`[data-path="${data.path}"]`);

        // Visual feedback
        const orig = renameBtn.innerHTML;
        renameBtn.innerHTML =
            '<span class="mi" style="font-size:16px">check_circle</span> Renamed!';
        renameBtn.style.background = "rgba(52,211,153,0.2)";
        renameBtn.style.color = "var(--success)";
        renameBtn.style.border = "1px solid rgba(52,211,153,0.4)";
        setTimeout(() => {
            renameBtn.innerHTML = orig;
            renameBtn.style.background = "";
            renameBtn.style.color = "";
            renameBtn.style.border = "";
            updateRenamePreview();
        }, 2500);
    } catch (e) {
        showFbError("Rename failed: " + e.message);
    }
});

// Update rename preview whenever a filename is generated
generateBtn.addEventListener("click", () =>
    setTimeout(updateRenamePreview, 50),
);
regenerateBtnDash.addEventListener("click", () =>
    setTimeout(updateRenamePreview, 50),
);
regenerateBtnPipe.addEventListener("click", () =>
    setTimeout(updateRenamePreview, 50),
);

// Initial load
fbLoadAll();
