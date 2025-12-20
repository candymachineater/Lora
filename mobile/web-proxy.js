const http = require('http');

const EXPO_PORT = 8081;
const PROXY_PORT = 3000;

const server = http.createServer((req, res) => {
  const options = {
    hostname: 'localhost',
    port: EXPO_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    // Check if this is the HTML response
    const contentType = proxyRes.headers['content-type'] || '';

    if (contentType.includes('text/html')) {
      let body = '';
      proxyRes.on('data', (chunk) => {
        body += chunk;
      });
      proxyRes.on('end', () => {
        // Add type="module" to the script tag
        const modifiedBody = body.replace(
          /<script src="([^"]+)" defer><\/script>/g,
          '<script type="module" src="$1"></script>'
        );

        res.writeHead(proxyRes.statusCode, {
          ...proxyRes.headers,
          'content-length': Buffer.byteLength(modifiedBody),
        });
        res.end(modifiedBody);
      });
    } else {
      // Pass through other responses unchanged
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.writeHead(502);
    res.end('Proxy error');
  });

  req.pipe(proxyReq);
});

server.listen(PROXY_PORT, () => {
  console.log(`\n  Web proxy running at http://localhost:${PROXY_PORT}`);
  console.log(`  Proxying to Expo at http://localhost:${EXPO_PORT}\n`);
});
