// Preload that fakes the GitHub update check: remote looks like v9.9.9.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, ...rest) => {
  const u = String(url);
  if (u.includes('api.github.com') && u.includes('/releases/latest')) {
    return new Response(JSON.stringify({ tag_name: 'v9.9.9' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (u.includes('api.github.com') && u.includes('contents/package.json')) {
    return new Response(JSON.stringify({ content: Buffer.from(JSON.stringify({ version: '9.9.9' })).toString('base64') }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return realFetch(u, ...rest);
};
