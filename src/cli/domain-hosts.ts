/** 고정된 로컬 도메인만 보완한다. Portless 관리 블록 밖에 둬 재동기화에도 유지한다. */
export const domainHostsScript = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const file = process.platform === 'win32'
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/drivers/etc/hosts')
  : '/etc/hosts';
const content = fs.readFileSync(file, 'utf8');
const present = content.split(/\r?\n/).some(line => {
  const [address, ...names] = line.split('#')[0].trim().split(/\s+/);
  return address === '::1' && names.includes('fast-jira.local');
});
if (process.argv.includes('--check')) {
  process.exitCode = present ? 0 : 1;
} else if (!present) {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  fs.writeFileSync(file, content + (content.endsWith('\n') ? '' : newline)
    + '::1 fast-jira.local # Fast Jira IPv6' + newline);
}
`;
