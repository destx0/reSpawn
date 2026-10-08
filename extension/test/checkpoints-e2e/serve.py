import http.server, os, sys
root, port = sys.argv[1], int(sys.argv[2])
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=root, **k)
    def log_message(self, *a): pass
    def send_head(self):
        p = self.translate_path(self.path.split('?')[0])
        if not os.path.exists(p): self.path = '/index.html'
        return super().send_head()
http.server.ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
