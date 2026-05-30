const CONFIG = {
  apiUrl: "/api/nfe",
  logoUrl: "https://sonoshowmoveis.vtexassets.com/assets/vtex.file-manager-graphql/images/9c25daff-344c-4bbf-9adf-054dba3b5137___c25ce75d1124b3ba71eebaaf2a2527e2.png",
};

const form = document.querySelector("#consulta-form");
const accessKeyInput = document.querySelector("#access-key");
const statusBox = document.querySelector("#status");
const danfeHost = document.querySelector("#danfe");
const actions = document.querySelector("#actions");
const printButton = document.querySelector("#print-button");
const danfeTemplate = document.querySelector("#danfe-template");
const nfceTemplate = document.querySelector("#nfce-template");

let currentXml = "";
let currentAccessKey = "";

accessKeyInput.addEventListener("input", () => {
  const digits = onlyDigits(accessKeyInput.value).slice(0, 44);
  accessKeyInput.value = formatAccessKey(digits);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const accessKey = onlyDigits(accessKeyInput.value);
  if (accessKey.length !== 44) {
    showStatus("A chave de acesso precisa ter exatamente 44 numeros.", "error");
    return;
  }

  currentAccessKey = accessKey;
  currentXml = "";
  actions.hidden = true;
  danfeHost.replaceChildren();
  danfeHost.hidden = true;
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
    danfeHost.replaceChildren();
    danfeHost.hidden = true;
    actions.hidden = true;
    if (shouldShowRecoveryMessage(error)) {
      showRecoveryStatus();
      return;
    }
    showConnectionStatus();
  }
});

printButton.addEventListener("click", () => {
  window.print();
});

async function fetchNfeXml(accessKey) {
  const url = new URL(CONFIG.apiUrl, window.location.origin);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35000);

  let response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, application/xml, text/xml, text/plain",
      },
      body: JSON.stringify({ chave: accessKey }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("A consulta demorou demais. Tente novamente em alguns instantes.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorMessage = await readErrorMessage(response);
    throw new Error(errorMessage || "Nota nao encontrada ou indisponivel no momento.");
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
  const transp = first(root, "transp");
  const transporta = first(transp, "transporta");
  const veicTransp = first(transp, "veicTransp");
  const volume = first(transp, "vol");
  const infAdic = first(root, "infAdic");
  const qrCode = text(first(root, "infNFeSupl"), "qrCode");
  const cobr = first(root, "cobr");
  const fat = first(cobr, "fat");
  const duplicatas = all(cobr, "dup").map((dup) => ({
    number: text(dup, "nDup"),
    dueDate: dateOnly(text(dup, "dVenc")),
    value: money(text(dup, "vDup")),
  }));

  const items = all(root, "det").map((det) => {
    const prod = first(det, "prod");
    const imposto = first(det, "imposto");
    const icmsNode = firstElement(first(imposto, "ICMS"));
    const ipiNode = firstElement(first(imposto, "IPI"));
    return {
      code: text(prod, "cProd"),
      description: text(prod, "xProd"),
      ncm: text(prod, "NCM"),
      cst: [text(icmsNode, "orig"), text(icmsNode, "CST") || text(icmsNode, "CSOSN")].filter(Boolean).join(""),
      cfop: text(prod, "CFOP"),
      quantity: numberText(text(prod, "qCom")),
      unit: text(prod, "uCom"),
      unitValue: money(text(prod, "vUnCom")),
      discount: money(text(prod, "vDesc")),
      total: money(text(prod, "vProd")),
      vBC: money(text(icmsNode, "vBC")),
      vICMS: money(text(icmsNode, "vICMS")),
      vIPI: money(text(ipiNode, "vIPI")),
      pICMS: percent(text(icmsNode, "pICMS")),
      pIPI: percent(text(ipiNode, "pIPI")),
    };
  });

  const emitAddressNode = first(emit, "enderEmit");
  const emitAddress = address(emitAddressNode);
  const emitAddressParts = addressParts(emitAddressNode);
  const destAddressNode = first(dest, "enderDest");
  const destAddressParts = addressParts(destAddressNode);
  const keyFromId = (infNFe?.getAttribute("Id") || "").replace(/^NFe/, "");
  const key = text(infProt, "chNFe") || keyFromId;
  const model = text(ide, "mod") || key.slice(20, 22);
  const dhEmi = text(ide, "dhEmi");
  const dhSaiEnt = text(ide, "dhSaiEnt");
  const emitCnpj = text(emit, "CNPJ");
  const destDoc = text(dest, "CNPJ") || text(dest, "CPF");
  const transpDoc = text(transporta, "CNPJ") || text(transporta, "CPF");
  const payments = all(root, "detPag").map((payment) => ({
    method: paymentMethod(text(payment, "tPag")),
    value: money(text(payment, "vPag")),
    valueNumber: decimalText(text(payment, "vPag")),
  }));
  const valorPago = payments.reduce((sum, payment) => sum + Number(String(payment.valueNumber).replace(/\./g, "").replace(",", ".")), 0);

  return {
    model,
    isNfce: model === "65",
    emitNome: text(emit, "xNome"),
    emitEndereco: emitAddress,
    emitEnderecoNfce: compactNfceAddress(emitAddressParts),
    emitDoc: docLabel(text(emit, "CNPJ")),
    emitDocNfce: docLabel(text(emit, "CNPJ")),
    emitCnpj: docValue(emitCnpj),
    emitIe: `IE ${text(emit, "IE") || "-"}`,
    emitIEValue: text(emit, "IE"),
    emitIEST: text(emit, "IEST"),
    numero: text(ide, "nNF"),
    serie: text(ide, "serie"),
    tpNF: text(ide, "tpNF"),
    chave: formatAccessKey(key),
    chaveNfce: formatAccessKey(key),
    resumoCanhoto: `${text(ide, "natOp")} - NF-e Nº ${text(ide, "nNF")} - Serie ${text(ide, "serie")}`,
    protocolo: protocolText(infProt),
    natureza: text(ide, "natOp"),
    destNome: text(dest, "xNome"),
    destDoc: docLabel(text(dest, "CNPJ") || text(dest, "CPF")),
    destDocValue: docValue(destDoc),
    destLogradouro: [destAddressParts.street, destAddressParts.complement].filter(Boolean).join(" - "),
    destBairro: destAddressParts.district,
    destCep: formatCep(destAddressParts.cep),
    destMunicipio: destAddressParts.city,
    destUF: destAddressParts.uf,
    destFone: text(destAddressNode, "fone"),
    destIE: text(dest, "IE"),
    emissaoData: dateOnly(dhEmi),
    emissaoCompleta: dateTime(dhEmi),
    saidaData: dateOnly(dhSaiEnt || dhEmi),
    saidaHora: timeOnly(dhSaiEnt),
    destIeSaida: [text(dest, "IE"), timeOnly(dhSaiEnt)].filter((value) => value && value !== "-").join("     "),
    items,
    billing: {
      invoice: text(fat, "nFat"),
      original: money(text(fat, "vOrig")),
      discount: money(text(fat, "vDesc")),
      net: money(text(fat, "vLiq")),
      duplicatas,
    },
    itemCount: String(items.length),
    vBC: money(text(total, "vBC")),
    vICMS: money(text(total, "vICMS")),
    vBCST: money(text(total, "vBCST")),
    vST: money(text(total, "vST")),
    vProd: money(text(total, "vProd")),
    vFrete: money(text(total, "vFrete")),
    vSeg: money(text(total, "vSeg")),
    vDesc: money(text(total, "vDesc")),
    vOutro: money(text(total, "vOutro")),
    vII: money(text(total, "vII")),
    vIPI: money(text(total, "vIPI")),
    vPIS: money(text(total, "vPIS")),
    vCOFINS: money(text(total, "vCOFINS")),
    vTotTrib: money(text(total, "vTotTrib")),
    vNF: money(text(total, "vNF")),
    vProdNumber: decimalText(text(total, "vProd")),
    vDescNumber: decimalText(text(total, "vDesc")),
    vOutroNumber: decimalText(text(total, "vOutro")),
    vNFNumber: decimalText(text(total, "vNF")),
    valorPagoNumber: valorPago.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    tributos: `Tributos incidentes: ${money(text(total, "vTotTrib"))}`,
    payments,
    mensagemFiscal: model === "65" ? "NFC-e emitida em ambiente de produção" : "",
    qrCodeUrl: qrCode,
    consultaUrl: model === "65" ? "www.fazenda.rj.gov.br/nfce/consulta" : qrCode || "www.nfce.fazenda.gov.br",
    consultaDataHora: new Date().toLocaleString("pt-BR"),
    destDocNfce: docLabel(destDoc),
    destEnderecoNfce: compactNfceAddress(destAddressParts),
    transportador: text(transporta, "xNome"),
    modFrete: freightMode(text(transp, "modFrete")),
    placa: text(veicTransp, "placa"),
    veicUF: text(veicTransp, "UF"),
    transpDoc: docValue(transpDoc),
    transpEndereco: text(transporta, "xEnder"),
    transpMunicipio: text(transporta, "xMun"),
    transpUF: text(transporta, "UF"),
    transpIE: text(transporta, "IE"),
    qVol: numberText(text(volume, "qVol")),
    espVol: text(volume, "esp"),
    marcaVol: text(volume, "marca"),
    nVol: text(volume, "nVol"),
    pesoL: weight(text(volume, "pesoL")),
    pesoB: weight(text(volume, "pesoB")),
    infCpl: text(infAdic, "infCpl") || "Sem informacoes adicionais.",
    infAdFisco: text(infAdic, "infAdFisco") || "-",
  };
}

function renderDanfe(data) {
  if (data.isNfce) {
    renderNfce(data);
    return;
  }

  const itemPages = splitDanfeItems(data.items);
  if (itemPages.length > 1) {
    const pages = itemPages.map((items, index) => {
      return buildDanfePage(data, items, {
        continuation: index > 0,
        finalPage: index === itemPages.length - 1,
      });
    });
    danfeHost.replaceChildren(...pages);
    danfeHost.hidden = false;
    return;
  }

  danfeHost.replaceChildren(buildDanfePage(data, data.items, { continuation: false, finalPage: true }));
  danfeHost.hidden = false;
}

function buildDanfePage(data, items, { continuation, finalPage }) {
  const fragment = danfeTemplate.content.cloneNode(true);
  const page = fragment.querySelector(".danfe-page");
  page.classList.toggle("danfe-continuation", continuation);
  page.classList.toggle("danfe-final-page", finalPage);
  page.classList.toggle("danfe-has-next-page", !finalPage);

  fragment.querySelectorAll("[data-field]").forEach((node) => {
    const field = node.dataset.field;
    if (field === "items") return;
    if (field === "billing") return;
    if (field === "billingTitle") return;
    node.textContent = data[field] || "-";
  });

  renderBilling(fragment, data.billing);
  prepareDanfePageSections(fragment, { continuation, finalPage });

  const body = fragment.querySelector('[data-field="items"]');
  items.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.description)}</td>
      <td>${escapeHtml(item.ncm)}</td>
      <td>${escapeHtml(item.cst)}</td>
      <td>${escapeHtml(item.cfop)}</td>
      <td>${escapeHtml(item.unit)}</td>
      <td class="number">${escapeHtml(item.quantity)}</td>
      <td class="number">${escapeHtml(item.unitValue)}</td>
      <td class="number">${escapeHtml(item.total)}</td>
      <td class="number">${escapeHtml(item.vBC)}</td>
      <td class="number">${escapeHtml(item.vICMS)}</td>
      <td class="number">${escapeHtml(item.vIPI)}</td>
      <td class="number">${escapeHtml(item.pICMS)}</td>
      <td class="number">${escapeHtml(item.pIPI)}</td>
    `;
    body.appendChild(row);
  });

  return page;
}

function splitDanfeItems(items) {
  const firstPageLimit = 7;
  const nextPageLimit = 18;
  if (items.length <= firstPageLimit) return [items];

  const pages = [items.slice(0, firstPageLimit)];
  for (let index = firstPageLimit; index < items.length; index += nextPageLimit) {
    pages.push(items.slice(index, index + nextPageLimit));
  }
  return pages;
}

function prepareDanfePageSections(fragment, { continuation, finalPage }) {
  if (!continuation && finalPage) return;

  if (continuation) {
    removeNodes(fragment, [
      ".receipt-stub",
      ".cut-line",
      ".two-cols",
      ".three-cols",
      ".destinatario-grid",
      ".tax-grid",
      ".billing-grid",
      ".transport-grid",
    ]);
    removeSectionTitles(fragment, [
      "Destinatario / Remetente",
      "Calculo do imposto",
      "Fatura / Duplicatas",
      "Transportador / Volumes transportados",
    ]);
  }

  if (!finalPage) {
    removeNodes(fragment, [".additional-grid"]);
    removeSectionTitles(fragment, ["Dados adicionais"]);
  }
}

function removeNodes(fragment, selectors) {
  selectors.forEach((selector) => {
    fragment.querySelectorAll(selector).forEach((node) => node.remove());
  });
}

function removeSectionTitles(fragment, titles) {
  fragment.querySelectorAll(".section-title").forEach((title) => {
    const normalized = title.textContent.trim().toLowerCase();
    if (titles.some((text) => normalized === text.toLowerCase())) {
      title.remove();
    }
  });
}

function renderBilling(fragment, billing) {
  const title = fragment.querySelector('[data-field="billingTitle"]');
  const host = fragment.querySelector('[data-field="billing"]');
  if (!host) return;

  const hasInvoice = billing?.invoice || billing?.duplicatas?.length;
  if (!hasInvoice) {
    title.hidden = true;
    host.hidden = true;
    return;
  }

  if (billing.invoice) {
    const invoice = document.createElement("div");
    invoice.className = "billing-summary danfe-cell";
    invoice.innerHTML = `
      <span>Fatura</span>
      <strong>Nº ${escapeHtml(billing.invoice)} | Valor original ${escapeHtml(billing.original)} | Desconto ${escapeHtml(billing.discount)} | Valor liquido ${escapeHtml(billing.net)}</strong>
    `;
    host.appendChild(invoice);
  }

  billing.duplicatas.forEach((dup) => {
    const card = document.createElement("div");
    card.className = "billing-dup danfe-cell";
    card.innerHTML = `
      <span>Duplicata</span>
      <strong>${escapeHtml(dup.number || "-")} &nbsp; ${escapeHtml(dup.dueDate || "-")} &nbsp; ${escapeHtml(dup.value || "-")}</strong>
    `;
    host.appendChild(card);
  });
}

function renderNfce(data) {
  const fragment = nfceTemplate.content.cloneNode(true);

  fragment.querySelectorAll("[data-field]").forEach((node) => {
    const field = node.dataset.field;
    if (field === "items" || field === "payments") return;
    node.textContent = data[field] || "-";
  });

  const itemsHost = fragment.querySelector('[data-field="items"]');
  data.items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "nfce-product";
    row.innerHTML = `
      <strong>${escapeHtml(item.description)}</strong>
      <em>(Código: ${escapeHtml(item.code)} )</em>
      <span>Qtde.:${escapeHtml(item.quantity)} UN: ${escapeHtml(item.unit)} Vl. Unit.: ${escapeHtml(decimalFromMoney(item.unitValue))} Vl. Total ${escapeHtml(decimalFromMoney(item.total))}</span>
    `;
    itemsHost.appendChild(row);
  });

  const paymentsHost = fragment.querySelector('[data-field="payments"]');
  data.payments.forEach((payment) => {
    const row = document.createElement("div");
    row.innerHTML = `<span>${escapeHtml(payment.method)}</span><strong>${escapeHtml(payment.valueNumber)}</strong>`;
    paymentsHost.appendChild(row);
  });

  const qrHost = fragment.querySelector(".qr-placeholder");
  if (data.qrCodeUrl && qrHost) {
    const qrImage = document.createElement("img");
    qrImage.alt = "QR Code da NFC-e";
    qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(data.qrCodeUrl)}`;
    qrHost.replaceChildren(qrImage);
    qrHost.classList.add("has-qr");
  }

  danfeHost.replaceChildren(fragment);
  danfeHost.hidden = false;
}

function showStatus(message, type = "") {
  statusBox.textContent = message;
  statusBox.className = `status ${type}`.trim();
  statusBox.hidden = false;
}

function showRecoveryStatus() {
  statusBox.className = "status recovery";
  statusBox.innerHTML = `
    <div class="recovery-card">
      <div class="recovery-logo">
        <img src="${CONFIG.logoUrl}" alt="Sono Show Moveis">
      </div>
      <div class="recovery-message">
        <strong>Não foi possivel Recuperar sua Nota por aqui.</strong>
        <p>Por favor entre em contato com o nosso SAC através do whatsapp <a href="https://wa.me/5521975145677" target="_blank" rel="noreferrer">(21) 97514-5677</a> ou por e-mail <a href="mailto:SAC@SONOSHOW.COM.BR">SAC@SONOSHOW.COM.BR</a>.</p>
        <span>HORÁRIO DE ATENDIMENTO: SEGUNDA A SEXTA DE 09:00 AS 17:00</span>
      </div>
    </div>
  `;
  statusBox.hidden = false;
}

function showConnectionStatus() {
  statusBox.className = "status connection";
  statusBox.innerHTML = `
    <div class="connection-card">
      <div class="connection-logo">
        <img src="${CONFIG.logoUrl}" alt="Sono Show Moveis">
      </div>
      <div class="connection-message">
        <strong>Perda de Conexão.</strong>
        <p>Por favor tente novamente.</p>
      </div>
    </div>
  `;
  statusBox.hidden = false;
}

function shouldShowRecoveryMessage(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("nao encontrada")
    || message.includes("não encontrada")
    || message.includes("xml nao encontrado")
    || message.includes("xml não encontrado")
    || message.includes("nao trouxe o xml")
    || message.includes("não trouxe o xml")
    || message.includes("nota nao encontrada")
    || message.includes("nota não encontrada");
}

function first(scope, tag) {
  return scope?.getElementsByTagName(tag)[0] || null;
}

function firstElement(scope) {
  return Array.from(scope?.children || [])[0] || null;
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

async function readErrorMessage(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null);
    return payload?.erro || payload?.message || payload?.mensagem || "";
  }

  return response.text().catch(() => "");
}

function formatAccessKey(value) {
  return onlyDigits(value).replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

function money(value) {
  const number = Number(String(value || "0").replace(",", "."));
  return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function percent(value) {
  if (!value) return "0,00";
  const number = Number(String(value || "0").replace(",", "."));
  return number.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function numberText(value) {
  const number = Number(String(value || "0").replace(",", "."));
  return number.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function decimalText(value) {
  const number = Number(String(value || "0").replace(",", "."));
  return number.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function decimalFromMoney(value) {
  return String(value || "").replace(/^R\$\s?/, "");
}

function dateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR");
}

function dateOnly(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR");
}

function timeOnly(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function docLabel(value) {
  const digits = onlyDigits(value);
  if (digits.length === 14) return `CNPJ ${digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}`;
  if (digits.length === 11) return `CPF ${digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")}`;
  return value || "-";
}

function docValue(value) {
  return docLabel(value).replace(/^CNPJ\s|^CPF\s/, "");
}

function address(node) {
  if (!node) return "-";
  const parts = addressParts(node);
  const city = [parts.city, parts.uf].filter(Boolean).join(" - ");
  const cep = parts.cep;
  const street = parts.street;
  const complement = parts.complement;
  const district = parts.district;
  return [street, complement, district, city, cep && `CEP ${cep}`].filter(Boolean).join(" | ");
}

function compactNfceAddress(parts) {
  if (!parts) return "-";
  const city = [parts.city, parts.uf].filter(Boolean).join(" - ");
  const cep = formatCep(parts.cep);
  return [parts.street, parts.district, city, cep && `CEP ${cep}`].filter(Boolean).join(" | ");
}

function addressParts(node) {
  if (!node) {
    return { street: "-", complement: "", district: "", city: "", uf: "", cep: "" };
  }

  return {
    street: [text(node, "xLgr"), text(node, "nro")].filter(Boolean).join(", "),
    complement: text(node, "xCpl"),
    district: text(node, "xBairro"),
    city: text(node, "xMun"),
    uf: text(node, "UF"),
    cep: text(node, "CEP"),
  };
}

function formatCep(value) {
  const digits = onlyDigits(value);
  if (digits.length === 8) return digits.replace(/^(\d{5})(\d{3})$/, "$1-$2");
  return value || "-";
}

function freightMode(value) {
  const modes = {
    0: "0 - Emitente",
    1: "1 - Destinatario",
    2: "2 - Terceiros",
    3: "3 - Proprio remetente",
    4: "4 - Proprio destinatario",
    9: "9 - Sem frete",
  };
  return modes[value] || value || "-";
}

function paymentMethod(value) {
  const methods = {
    "01": "Dinheiro",
    "02": "Cheque",
    "03": "Cartao de credito",
    "04": "Cartao de debito",
    "05": "Credito loja",
    "10": "Vale alimentacao",
    "11": "Vale refeicao",
    "12": "Vale presente",
    "13": "Vale combustivel",
    "15": "Boleto bancario",
    "16": "Deposito bancario",
    "17": "PIX",
    "18": "Transferencia bancaria",
    "19": "Programa de fidelidade",
    "90": "Sem pagamento",
    "99": "Outros",
  };
  return methods[value] || value || "-";
}

function weight(value) {
  if (!value) return "-";
  const number = Number(String(value).replace(",", "."));
  return `${number.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
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
