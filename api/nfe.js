const Firebird = require("node-firebird");

const DEFAULT_SQL = `
  SELECT X.XMLNFE
  FROM LFNF L
  JOIN LFNFXML X ON L.IDFILIAL = X.IDFILIAL AND L.ID = X.ID
  WHERE L.CHAVENFE = ?
  AND L.STATUS = 'A'
`;
const DEFAULT_XML_FIELD = "XMLNFE";
const QUERY_TIMEOUT_MS = 25000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Metodo nao permitido" });
  }

  const chave = String(req.body?.chave || "").replace(/\D/g, "");
  if (chave.length !== 44) {
    return res.status(400).json({ erro: "Chave de acesso invalida." });
  }

  const missingEnv = getMissingDatabaseEnv();
  if (missingEnv.length > 0) {
    console.error("Variaveis de ambiente ausentes:", missingEnv.join(", "));
    return res.status(500).json({
      erro: `Configuracao do banco incompleta na Vercel: ${missingEnv.join(", ")}.`,
    });
  }

  const options = {
    host: process.env.DB_HOST_FB,
    port: process.env.DB_PORT_FB,
    database: process.env.DB_PATH_FB,
    user: process.env.DB_USER_FB,
    password: process.env.DB_PASSWORD_FB,
    lowercase_keys: false,
    pageSize: 4096,
  };

  let database = null;
  let finished = false;
  let stage = "conectar ao banco";

  const timer = setTimeout(() => {
    finish(504, {
      erro: `A consulta demorou demais ao tentar ${stage}. Verifique conexao com o banco, VPN/firewall ou tempo de resposta do Firebird.`,
    });
  }, QUERY_TIMEOUT_MS);

  function finish(status, payload) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);

    if (database) {
      try {
        database.detach();
      } catch (detachErr) {
        console.error("Erro ao fechar conexao Firebird:", detachErr.message);
      }
    }

    return res.status(status).json(payload);
  }

  Firebird.attach(options, function attachCallback(err, db) {
    if (err) {
      const technicalError = {
        message: err.message,
        code: err.code,
      };

      console.error("Erro de Conexao Firebird:", {
        ...technicalError,
        hostConfigured: Boolean(process.env.DB_HOST_FB),
        portConfigured: Boolean(process.env.DB_PORT_FB),
        databaseConfigured: Boolean(process.env.DB_PATH_FB),
      });

      return finish(500, {
        erro: "Falha ao conectar no servidor remoto. Verifique as variaveis da Vercel, rede/firewall e logs da funcao.",
      });
    }

    database = db;
    stage = "consultar a NF-e";
    const sql = process.env.NFE_XML_SQL || DEFAULT_SQL;
    const xmlField = process.env.NFE_XML_FIELD || DEFAULT_XML_FIELD;

    db.query(sql, [chave], async function queryCallback(queryErr, result) {
      if (queryErr) {
        console.error("Erro na Query:", queryErr.message);
        return finish(500, { erro: "Erro ao consultar banco de dados." });
      }

      if (!result || result.length === 0) {
        return finish(404, { erro: "NF-e nao encontrada." });
      }

      try {
        stage = "ler o XML da NF-e";
        const xml = await normalizeXml(result[0][xmlField]);
        if (!xml) {
          return finish(404, { erro: "XML nao encontrado para esta chave." });
        }

        return finish(200, { xml });
      } catch (xmlErr) {
        console.error("Erro ao ler XML:", xmlErr.message);
        return finish(500, { erro: "Nao foi possivel ler o XML da NF-e." });
      }
    });
  });
}

function getMissingDatabaseEnv() {
  return ["DB_HOST_FB", "DB_PORT_FB", "DB_PATH_FB", "DB_USER_FB", "DB_PASSWORD_FB"].filter((key) => {
    return !String(process.env[key] || "").trim();
  });
}

function normalizeXml(value) {
  if (!value) return Promise.resolve("");
  if (typeof value === "string") return Promise.resolve(value.trim());
  if (Buffer.isBuffer(value)) return Promise.resolve(value.toString("utf8").trim());

  if (typeof value === "function") {
    return new Promise((resolve, reject) => {
      value((err, _name, eventEmitter) => {
        if (err) return reject(err);

        const chunks = [];
        eventEmitter.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        eventEmitter.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").trim()));
        eventEmitter.on("error", reject);
      });
    });
  }

  return Promise.resolve(String(value).trim());
}
