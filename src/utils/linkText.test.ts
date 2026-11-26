import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractLinksFromText,
  formatDisplayLinkLabel,
  parseLinkSegments,
  sanitizeExternalHttpUrl,
} from './linkText';

test('parseLinkSegments detects http/https, www, and campus/sponsorship domain links cleanly', () => {
  const announcement =
    'Scholarship & Sponsorship portal open! Apply at https://lasued.edu.ng/scholarships?cohort=2026 or check www.lasuedintel.com.ng/updates and forms.gle/abcXYZ123 before Friday.';

  const segments = parseLinkSegments(announcement);
  const links = segments.filter((s) => s.type === 'link');

  assert.equal(links.length, 3);
  assert.equal(links[0]?.value, 'https://lasued.edu.ng/scholarships?cohort=2026');
  assert.equal(links[0]?.href, 'https://lasued.edu.ng/scholarships?cohort=2026');

  assert.equal(links[1]?.value, 'www.lasuedintel.com.ng/updates');
  assert.equal(links[1]?.href, 'https://www.lasuedintel.com.ng/updates');

  assert.equal(links[2]?.value, 'forms.gle/abcXYZ123');
  assert.equal(links[2]?.href, 'https://forms.gle/abcXYZ123');

  // Reconstructing raw text preserves exact characters including trailing period
  assert.equal(segments.map((s) => s.value).join(''), announcement);
});

test('parseLinkSegments handles parentheses, trailing punctuation, WhatsApp/Telegram links, and nested replies', () => {
  const reply =
    'Join the sponsorship group (https://chat.whatsapp.com/AbCdEf123456), or DM wa.me/2348012345678! Docs: https://en.wikipedia.org/wiki/Lagos_(state).';

  const links = extractLinksFromText(reply);
  assert.deepEqual(links, [
    'https://chat.whatsapp.com/AbCdEf123456',
    'https://wa.me/2348012345678',
    'https://en.wikipedia.org/wiki/Lagos_(state)',
  ]);

  const segments = parseLinkSegments(reply);
  assert.equal(segments.map((s) => s.value).join(''), reply);
});

test('parseLinkSegments never turns email addresses, GPA decimals, or plain periods into links', () => {
  const text =
    'Contact admin@lasued.edu.ng if your CGPA is 4.50 or 3.75. Wait.Next line has no link at all.';
  const segments = parseLinkSegments(text);
  assert.equal(segments.filter((s) => s.type === 'link').length, 0);
  assert.equal(segments.map((s) => s.value).join(''), text);
});

test('sanitizeExternalHttpUrl blocks unsafe schemes and preserves safe external http/https URLs', () => {
  assert.equal(sanitizeExternalHttpUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeExternalHttpUrl('data:text/html,<script>'), null);
  assert.equal(sanitizeExternalHttpUrl('vbscript:msgbox(1)'), null);
  assert.equal(
    sanitizeExternalHttpUrl('bit.ly/lasued-grant'),
    'https://bit.ly/lasued-grant'
  );
  assert.equal(
    sanitizeExternalHttpUrl('http://portal.lasued.edu.ng/login'),
    'http://portal.lasued.edu.ng/login'
  );
});

test('formatDisplayLinkLabel truncates very long links without cutting short links', () => {
  assert.equal(formatDisplayLinkLabel('https://lasued.edu.ng'), 'https://lasued.edu.ng');
  const longUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSdVeryLongCampusScholarshipFormIdentifier/viewform';
  const shortened = formatDisplayLinkLabel(longUrl, 40);
  assert.equal(shortened.length, 40);
  assert.ok(shortened.endsWith('…'));
});
