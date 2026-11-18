'use strict';

process.env.BAMBI_VERCEL_RUNTIME = '1';
const { handleRequest } = require('../server');

module.exports = (request, response) => {
  const url = new URL(request.url, 'https://localhost');
  const routedPath = request.query?.__site_path ?? url.searchParams.get('__site_path');
  return handleRequest(request, response, typeof routedPath === 'string' ? routedPath : url.pathname);
};
