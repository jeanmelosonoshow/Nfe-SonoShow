const CONFIG = {
  apiUrl: "/api/nfe",
};

const form = document.querySelector("#consulta-form");
const accessKeyInput = document.querySelector("#access-key");
const statusBox = document.querySelector("#status");
const danfeHost = document.querySelector("#danfe");
const actions = document.querySelector("#actions");
const printButton = document.querySelector("#print-button");
const xmlButton = document.querySelector("#xml-button");
const template = document.querySelector("#danfe-template");

let currentXml = "";
let currentAccessKey = "";

accessKeyInput.addEventListener("input", () => {
  const digits = onlyDigits(accessKeyInput.value).slice(0, 44);
  accessKeyInput.value = digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const accessKey = onlyDigits(accessKeyInput.value);
  if (accessKey.length !== 44) {
    showStatus("A chave de acesso precisa ter exatamente 44 numeros.", "error");
    return;
  }

  currentAccessKey = accessKey;
  showStatus("Consultando a nota fiscal...");

  try {
    const xml = await fetchNfeXml(accessKey);
    const data = parseNfe(xml);
    renderDanfe(data);
    currentXml = xml;
    actions.hidden = false;
    showStatus("DANFE encontrada. Voce ja pode imprimir ou salvar em PDF.", "success");
  } catch (error) {
    console.error(error);
    danfeHost.hidden = true;
    actions.hidden = true;
    showStatus(error.message || "Nao foi possivel consultar a NF-e.", "error");
  }
});

printButton.addEventListener("click", () => {
  window.print();
});

xmlButton.addEventListener("click", () => {
  if (!currentXml) return;

  const blob = new Blob([currentXml], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${currentAccessKey || "nfe"}.xml`;
  link.click();
  URL.revokeObjectURL(url);
});

async function fetchNfeXml(accessKey) {
  const url = new URL(CONFIG.apiUrl, window.location.origin);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, application/xml, text/xml, text/plain",
    },
    body: JSON.stringify({ chave: accessKey }),
  });

  if (!response.ok) {
    throw new Error("Nota nao encontrada ou indisponivel no momento.");
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json();
    const xml = payload.xml || payload.nfeXml || payload.data?.xml;
    if (!xml) throw new Error("A API respondeu, mas nao trouxe o XML da NF-e.");
    return xml;
  }

  return response.text();
}

function parseNfe(xmlText) {
  const documentXml = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = documentXml.querySelector("parsererror");
  if (parserError) {
    throw new Error("O XML retornado nao parece ser uma NF-e valida.");
  }

  const root = documentXml;
  const infNFe = first(root, "infNFe");
  const ide = first(root, "ide");
  const emit = first(root, "emit");
  const dest = first(root, "dest");
  const total = first(root, "ICMSTot");
  const infProt = first(root, "infProt");

  const items = all(root, "det").map((det) => {
    const prod = first(det, "prod");
    return {
      code: text(prod, "cProd"),
      description: text(prod, "xProd"),
      ncm: text(prod, "NCM"),
      cfop: text(prod, "CFOP"),
      quantity: numberText(text(prod, "qCom")),
      unit: text(prod, "uCom"),
      unitValue: money(text(prod, "vUnCom")),
      total: money(text(prod, "vProd")),
    };
  });

  const emitAddress = address(first(emit, "enderEmit"));
  const destAddress = address(first(dest, "enderDest"));
  const keyFromId = (infNFe?.getAttribute("Id") || "").replace(/^NFe/, "");
  const key = text(infProt, "chNFe") || keyFromId;

  return {
    emitNome: text(emit, "xNome"),
    emitEndereco: emitAddress,
    emitDoc: docLabel(text(emit, "CNPJ")),
    numero: text(ide, "nNF"),
    serie: text(ide, "serie"),
    chave: formatAccessKey(key),
    protocolo: protocolText(infProt),
    natureza: text(ide, "natOp"),
    destNome: text(dest, "xNome"),
    destDoc: docLabel(text(dest, "CNPJ") || text(dest, "CPF")),
    destEndereco: destAddress,
    emissao: dateTime(text(ide, "dhEmi")),
    items,
    vBC: money(text(total, "vBC")),
    vICMS: money(text(total, "vICMS")),
    vProd: money(text(total, "vProd")),
    vNF: money(text(total, "vNF")),
    infCpl: text(first(root, "infAdic"), "infCpl") || "Sem informacoes adicionais.",
  };
}

function renderDanfe(data) {
  const fragment = template.content.cloneNode(true);

  fragment.querySelectorAll("[data-field]").forEach((node) => {
    const field = node.dataset.field;
    if (field === "items") return;
    node.textContent = data[field] || "-";
  });

  const body = fragment.querySelector('[data-field="items"]');
  data.items.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.description)}</td>
      <td>${escapeHtml(item.ncm)}</td>
      <td>${escapeHtml(item.cfop)}</td>
      <td class="number">${escapeHtml(item.quantity)}</td>
      <td>${escapeHtml(item.unit)}</td>
      <td class="number">${escapeHtml(item.unitValue)}</td>
      <td class="number">${escapeHtml(item.total)}</td>
    `;
    body.appendChild(row);
  });

  danfeHost.replaceChildren(fragment);
  danfeHost.hidden = false;
}

function showStatus(message, type = "") {
  statusBox.textContent = message;
  statusBox.className = `status ${type}`.trim();
  statusBox.hidden = false;
}

function first(scope, tag) {
  return scope?.getElementsByTagName(tag)[0] || null;
}

function all(scope, tag) {
  return Array.from(scope?.getElementsByTagName(tag) || []);
}

function text(scope, tag) {
  return first(scope, tag)?.textContent?.trim() || "";
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatAccessKey(value) {
  return onlyDigits(value).replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

function money(value) {
  const number = Number(String(value || "0").replace(",", "."));
  return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function numberText(value) {
  const number = Number(String(value || "0").replace(",", "."));
  return number.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function dateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR");
}

function docLabel(value) {
  const digits = onlyDigits(value);
  if (digits.length === 14) return `CNPJ ${digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}`;
  if (digits.length === 11) return `CPF ${digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")}`;
  return value || "-";
}

function address(node) {
  if (!node) return "-";
  const street = [text(node, "xLgr"), text(node, "nro")].filter(Boolean).join(", ");
  const complement = text(node, "xCpl");
  const district = text(node, "xBairro");
  const city = [text(node, "xMun"), text(node, "UF")].filter(Boolean).join(" - ");
  const cep = text(node, "CEP");
  return [street, complement, district, city, cep && `CEP ${cep}`].filter(Boolean).join(" | ");
}

function protocolText(node) {
  const protocol = text(node, "nProt");
  const receipt = dateTime(text(node, "dhRecbto"));
  const reason = text(node, "xMotivo");
  return [protocol, receipt, reason].filter(Boolean).join(" - ");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}
