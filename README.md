# Nfe-SonoShow

Pagina publica para consulta de DANFE da Sono Show Moveis.

## API da Vercel

O projeto ja chama a rota local da Vercel:

```js
const CONFIG = {
  apiUrl: "/api/nfe",
};
```

A rota `api/nfe.js` recebe:

```txt
POST /api/nfe
```

com o corpo:

```json
{ "chave": "33260505507218000150550050000097861003827552" }
```

e responde:

```json
{ "xml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><nfeProc..." }
```

## Variaveis da Vercel

Use as mesmas variaveis de conexao Firebird que voce ja usa:

```txt
DB_HOST_FB
DB_PORT_FB
DB_PATH_FB
DB_USER_FB
DB_PASSWORD_FB
```

Por padrao, a API ja consulta o XML com:

```txt
SELECT X.XMLNFE
FROM LFNF L
JOIN LFNFXML X ON L.IDFILIAL = X.IDFILIAL AND L.ID = X.ID
WHERE L.CHAVENFE = ?
```

Se algum dia precisar trocar a consulta sem alterar o codigo, configure:

```txt
NFE_XML_SQL
NFE_XML_FIELD
```

O campo padrao de retorno e `XMLNFE`.

## Publicacao

Este projeto deve ser publicado na Vercel para que a rota `api/nfe.js` funcione.

Depois de configurar as variaveis, publique pela Vercel e teste uma chave real.
