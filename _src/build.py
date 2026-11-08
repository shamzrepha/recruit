import pathlib, re
src = pathlib.Path(__file__).parent
root = src.parent
sprite = (src/'sprite.html').read_text().strip()
bar = (src/'topbar.html').read_text().strip()
cfg = {
  'index':     dict(hire='', cand=''),
  'jobs':      dict(hire='', cand=' aria-current="page"'),
  'account':   dict(hire='', cand=''),
  'apply':     dict(hire='', cand=' aria-current="page"'),
  'interview': dict(hire='', cand=' aria-current="page"'),
  'privacy':   dict(hire='', cand=''),
  'terms':     dict(hire='', cand=''),
  '404':       dict(hire='', cand=''),
}
LEGAL = ' <span class="legal-links"><a href="/privacy">Privacy</a> &middot; <a href="/terms">Terms</a></span></p></footer>'
for name, c in cfg.items():
    f = src/f'{name}.src.html'
    if not f.exists(): continue
    html = f.read_text()
    b = bar.replace('__HIRE__', c['hire']).replace('__CAND__', c['cand'])
    html = re.sub(r'</p></footer>', LEGAL, html, count=1)
    html = html.replace('<!--SPRITE-->', sprite).replace('<!--TOPBAR-->', b)
    (root/f'{name}.html').write_text(html)
    print('built', name, len(html))
# hire has its own shell, only needs the sprite
f = src/'hire.src.html'
if f.exists():
    (root/'hire.html').write_text(f.read_text().replace('<!--SPRITE-->', sprite))
    print('built hire')
