"""Temporary invitation access for the HTTP transport, independent of world rules."""
from __future__ import annotations

import hmac
import re
from http.cookies import SimpleCookie, CookieError
from urllib.parse import urlsplit

COOKIE_NAME = '__Host-m1_invite'


def public_origin(value):
    parsed = urlsplit(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.path not in ('', '/')
            or parsed.query or parsed.fragment or parsed.hostname in ('localhost', '127.0.0.1', '::1')):
        raise ValueError('Public origin must be one exact HTTPS origin')
    if parsed.port is not None and parsed.port != 443:
        raise ValueError('Public origin must use the HTTPS default port')
    return 'https://' + parsed.hostname.lower()


class ShareAccess:
    def __init__(self, origin, token, lifetime=7200):
        self.origin = public_origin(origin)
        if not isinstance(token, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{32,128}', token):
            raise ValueError('Invitation must have 32 to 128 URL-safe characters')
        self._token = token
        self.lifetime = lifetime

    def accepts_origin(self, origin):
        return origin == self.origin

    def accepts_token(self, token):
        return isinstance(token, str) and hmac.compare_digest(token.encode(), self._token.encode())

    def authorized(self, cookie):
        jar = SimpleCookie()
        try:
            jar.load(cookie or '')
        except CookieError:
            return False
        value = jar.get(COOKIE_NAME)
        return value is not None and self.accepts_token(value.value)

    def cookie(self):
        return (f'{COOKIE_NAME}={self._token}; Path=/; Max-Age={self.lifetime}; '
                'Secure; HttpOnly; SameSite=Strict')


WELCOME = '''<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>冰焰解冻之旅 · 试玩邀请</title>
<style>*{box-sizing:border-box}body{margin:0;padding:32px 24px;min-height:100dvh;display:grid;place-content:center;background:#17262b;color:#f0f3f2;font:18px/1.7 system-ui,sans-serif;letter-spacing:0}main{max-width:480px}h1{font-size:28px;margin:0 0 16px}p{margin:12px 0;color:#d0dce0}label{display:block;margin-top:24px}input,button{width:100%;font:inherit;min-height:48px;padding:10px 12px;border:1px solid #8aa89e;border-radius:4px}input{background:#eff4f1;color:#17262b}button{margin-top:12px;background:#33725d;color:white;cursor:pointer}button:disabled{opacity:.6}#status{min-height:32px;color:#f3d88d}input:focus-visible,button:focus-visible{outline:3px solid #f3d88d;outline-offset:3px}</style>
<main><h1>冰焰解冻之旅</h1><p>带着永焰进入冰宫，寻找居民与离开的路。</p>
<form id="welcome"><label for="invite">试玩邀请码</label><input id="invite" type="password" autocomplete="off" required><button id="enter">进入游戏</button></form><p id="status" role="status"></p></main>
<script>
const field=document.querySelector('#invite'),form=document.querySelector('#welcome'),button=document.querySelector('#enter'),status=document.querySelector('#status');
const invitation=new URLSearchParams(location.hash.slice(1)).get('invite');
history.replaceState(null,'','/');
async function enter(){button.disabled=true;status.textContent='正在连接冰宫…';try{const response=await fetch('/api/access',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({invite:field.value})});const value=await response.json();if(!response.ok)throw Error(value.error||'暂时无法连接，请稍后重试。');location.replace('/');}catch(error){status.textContent=error.message;button.disabled=false;}}
form.onsubmit=event=>{event.preventDefault();enter();};if(invitation){field.value=invitation;enter();}
</script></html>'''
