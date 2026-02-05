#!/usr/bin/env python3
import urllib.request
import urllib.parse
import re
import os
from html.parser import HTMLParser
from pathlib import Path

class LinkExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = {
            'css': set(),
            'js': set(),
            'images': set(),
            'pages': set()
        }

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)

        if tag == 'link' and attrs_dict.get('rel') == 'stylesheet':
            if 'href' in attrs_dict:
                self.links['css'].add(attrs_dict['href'])

        elif tag == 'script' and 'src' in attrs_dict:
            self.links['js'].add(attrs_dict['src'])

        elif tag == 'img' and 'src' in attrs_dict:
            self.links['images'].add(attrs_dict['src'])

        elif tag == 'a' and 'href' in attrs_dict:
            href = attrs_dict['href']
            if href.startswith('/') and not href.startswith('//'):
                self.links['pages'].add(href)

def download_file(url, filepath):
    """Download a file from URL to filepath"""
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
        req = urllib.request.Request(url, headers=headers)

        with urllib.request.urlopen(req, timeout=30) as response:
            content = response.read()

        os.makedirs(os.path.dirname(filepath), exist_ok=True)

        with open(filepath, 'wb') as f:
            f.write(content)

        print(f"✓ Downloaded: {url}")
        return True
    except Exception as e:
        print(f"✗ Failed: {url} - {str(e)}")
        return False

def scrape_website(base_url):
    """Scrape the entire website"""
    print(f"Starting to scrape: {base_url}\n")

    # Download main page
    print("Downloading main page...")
    html_content = None
    try:
        headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
        req = urllib.request.Request(base_url, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as response:
            html_content = response.read().decode('utf-8')

        with open('original/index.html', 'w', encoding='utf-8') as f:
            f.write(html_content)
        print("✓ Main page downloaded\n")
    except Exception as e:
        print(f"✗ Failed to download main page: {e}")
        return

    # Extract links
    print("Extracting links...")
    parser = LinkExtractor()
    parser.feed(html_content)

    print(f"Found: {len(parser.links['css'])} CSS files")
    print(f"Found: {len(parser.links['js'])} JS files")
    print(f"Found: {len(parser.links['images'])} images")
    print(f"Found: {len(parser.links['pages'])} internal pages\n")

    # Download CSS files
    print("Downloading CSS files...")
    for css_url in parser.links['css']:
        if css_url.startswith('//'):
            css_url = 'https:' + css_url
        elif css_url.startswith('/'):
            css_url = base_url.rstrip('/') + css_url
        elif not css_url.startswith('http'):
            continue

        filename = 'original/assets/css/' + css_url.split('/')[-1].split('?')[0]
        download_file(css_url, filename)

    # Download JS files
    print("\nDownloading JS files...")
    for js_url in parser.links['js']:
        if js_url.startswith('//'):
            js_url = 'https:' + js_url
        elif js_url.startswith('/'):
            js_url = base_url.rstrip('/') + js_url
        elif not js_url.startswith('http'):
            continue

        filename = 'original/assets/js/' + js_url.split('/')[-1].split('?')[0]
        download_file(js_url, filename)

    print("\n✅ Scraping complete!")
    print(f"\nAll files saved in: {os.getcwd()}/original/")

if __name__ == "__main__":
    os.makedirs('original/assets/css', exist_ok=True)
    os.makedirs('original/assets/js', exist_ok=True)
    os.makedirs('original/assets/images', exist_ok=True)

    scrape_website('https://www.yogabible.dk')
