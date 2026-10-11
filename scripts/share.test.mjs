import assert from 'node:assert/strict';
import test from 'node:test';
import { sharingConfiguration, tunnelOrigin } from './share.mjs';

test('sharing uses a separate local port and a bounded window', () => {
  const config = sharingConfiguration({});
  assert.equal(config.webPort, 5195);
  assert.equal(config.minutes, 120);
  assert.equal(config.maxGames, 16);
  assert.equal(config.preview, true);
});
test('explicit sharing configuration stays finite', () => {
  for (const minutes of ['0', 'NaN', '1441', '1.5']) assert.throws(() => sharingConfiguration({M1_SHARE_MINUTES: minutes}));
  for (const max of ['0', 'NaN', '129', '1.5']) assert.throws(() => sharingConfiguration({M1_SHARE_MAX_GAMES: max}));
  const config = sharingConfiguration({M1_SHARE_PORT:'5196', M1_SHARE_MINUTES:'60', M1_SHARE_MAX_GAMES:'4', CLOUDFLARED:'/trusted/cloudflared'});
  assert.equal(config.webPort,5196);
  assert.equal(config.cloudflared,'/trusted/cloudflared');
});
test('only the temporary HTTPS hostname is selected from tunnel output', () => {
  assert.equal(tunnelOrigin('https://developers.cloudflare.com/ and https://a-b.trycloudflare.com |'), 'https://a-b.trycloudflare.com');
  assert.equal(tunnelOrigin('http://localhost:5195'),null);
  assert.equal(tunnelOrigin('https://example.com'),null);
  assert.equal(tunnelOrigin('https://a-b.trycloudflare.com.evil.example'),null);
  assert.equal(tunnelOrigin('https://a-b.trycloudflare.com:8080'),null);
});
