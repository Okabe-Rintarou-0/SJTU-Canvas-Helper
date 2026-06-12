#!/usr/bin/env node
import http from 'node:http';
import readline from 'node:readline';

const MCP_HOST = process.env.MCP_HOST || 'localhost';
const MCP_PORT = parseInt(process.env.MCP_PORT || '3100', 10);
const MCP_TOKEN = process.env.CANVAS_API_TOKEN || '';

function sendRequest(body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const options = {
      hostname: MCP_HOST,
      port: MCP_PORT,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };
    if (MCP_TOKEN) {
      options.headers['Authorization'] = `Bearer ${MCP_TOKEN}`;
    }
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });
    req.on('error', (e) => reject(new Error(`HTTP request failed: ${e.message}`)));
    req.write(postData);
    req.end();
  });
}

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', async (line) => {
  try {
    const request = JSON.parse(line);
    const response = await sendRequest(request);
    console.log(JSON.stringify(response));
  } catch (e) {
    console.error(JSON.stringify({ error: e.message }));
  }
});
