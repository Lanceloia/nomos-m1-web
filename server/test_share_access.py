"""Short HTTP access tests; no world compilation or rule fixtures."""
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from server.bridge import Bridge, make_handler
from server.share_access import ShareAccess, public_origin


class ShareAccessTests(unittest.TestCase):
    token = 'a' * 48
    origin = 'https://demo.trycloudflare.com'

    def setUp(self):
        self.share = ShareAccess(self.origin, self.token)
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        (self.root / 'index.html').write_text('BUILT_GAME')
        self.bridge = SimpleNamespace(state='ready', compile_count=1, runtime_info={'secret': 'private path'})
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(self.bridge, self.root, self.share))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.folder.cleanup()

    def request(self, path='/', body=None, origin=None, cookie=None):
        headers = {}
        if origin is not None:
            headers['Origin'] = origin
        if cookie is not None:
            headers['Cookie'] = cookie
        if body is not None:
            headers['Content-Type'] = 'application/json'
        request = Request(self.base + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
        try:
            response = urlopen(request, timeout=2)
        except HTTPError as error:
            response = error
        with response:
            return response.status, response.read().decode(), response.headers

    def test_invitation_opens_only_the_built_game(self):
        status, page, _ = self.request()
        self.assertEqual(status, 200)
        self.assertIn('试玩邀请码', page)
        self.assertNotIn('BUILT_GAME', page)
        status, _, headers = self.request('/api/access', {'invite': self.token}, self.origin)
        self.assertEqual(status, 200)
        cookie = headers['Set-Cookie']
        for flag in ('Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/'):
            self.assertIn(flag, cookie)
        status, page, _ = self.request(cookie=cookie.split(';')[0])
        self.assertEqual((status, page), (200, 'BUILT_GAME'))

    def test_wrong_or_absent_invitation_never_reaches_world(self):
        self.assertEqual(self.request('/api/sessions')[0], 401)
        self.assertEqual(self.request('/assets/game.js')[0], 401)
        self.assertEqual(self.request('/api/access', {'invite': 'wrong'}, self.origin)[0], 401)
        self.assertEqual(self.request('/api/access', [], self.origin)[0], 401)
        self.assertEqual(self.request(cookie='broken="')[0], 200)

    def test_mutation_requires_the_exact_published_origin(self):
        for origin in (None, 'https://elsewhere.com', self.origin + '.evil', 'http://demo.trycloudflare.com'):
            self.assertEqual(self.request('/api/access', {'invite': self.token}, origin)[0], 403)

    def test_health_never_exposes_runtime_paths(self):
        status, value, _ = self.request('/api/health')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(value), {'ok': True, 'status': 'ready', 'engine': 'NomosEngine2', 'compileCount': 1})

    def test_origins_and_invitation_shape_are_closed(self):
        for value in ('http://example.com', 'https://user@example.com', 'https://example.com/path', 'https://example.com?x', 'https://example.com:123', 'https://localhost'):
            with self.assertRaises(ValueError):
                public_origin(value)
        self.assertEqual(public_origin('https://EXAMPLE.com/'), 'https://example.com')
        with self.assertRaises(ValueError):
            ShareAccess(self.origin, 'short')
        self.assertFalse(self.share.accepts_token('é' * 48))

    def test_transport_session_limit_is_explicit_and_validated(self):
        self.assertEqual(Bridge(None, None, 16).max_games, 16)
        for value in (0, 129, True):
            with self.assertRaises(ValueError):
                Bridge(None, None, value)


if __name__ == '__main__':
    unittest.main()
