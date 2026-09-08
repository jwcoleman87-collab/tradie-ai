"""Strip synthetic passwords and auth tokens from distributable Playwright traces."""
import re
import sys
import zipfile

source, destination = sys.argv[1:]
with zipfile.ZipFile(source) as original, zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as sanitized:
    for item in original.infolist():
        data = original.read(item.filename)
        try:
            text = data.decode('utf-8')
        except UnicodeDecodeError:
            sanitized.writestr(item.filename, data)
            continue
        text = re.sub(r'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', 'REDACTED_SYNTHETIC_JWT', text)
        text = re.sub(r'review-refresh-[a-f0-9-]+', 'REDACTED_SYNTHETIC_REFRESH_TOKEN', text)
        text = text.replace('SyntheticReviewPassword123', 'REDACTED_SYNTHETIC_PASSWORD')
        text = text.replace('synthetic-review-provider-key', 'REDACTED_SYNTHETIC_PROVIDER_KEY')
        sanitized.writestr(item.filename, text.encode())
print('Sanitized trace written; auth tokens and synthetic passwords removed.')
