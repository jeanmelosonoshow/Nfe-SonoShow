# Nfe-SonoShow

Pagina publica para consulta de DANFE da Sono Show Moveis.

## Como configurar a API

No arquivo `app.js`, altere o campo `apiUrl`:

```js
const CONFIG = {
  apiUrl: "https://sua-api.vercel.app/api/nfe",
};
```

A API deve aceitar a chave da NF-e no parametro `chave`:

```txt
GET /api/nfe?chave=33260505507218000150550050000097861003827552
```

Ela pode responder de duas formas:

```json
{ "xml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?><nfeProc..." }
```

ou devolver o XML puro com `Content-Type: application/xml`.

## Publicacao

Este projeto pode ser publicado como pagina estatica no GitHub Pages ou na Vercel.

Depois de configurar a URL da API, abra `index.html` no navegador para testar a consulta.
