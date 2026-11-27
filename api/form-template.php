<?php
/* =====================================================================
 * Form templates, replaced from the Form Designer.
 *
 *   POST ?page=hr|employee&template=templates/<name>.docx
 *        body: the Word file itself
 *        -> {"ok":true,"stamp":"...","backup":"...","github":{...}}
 *
 * "Replace on portal" used to write the file to GitHub from the browser,
 * which needed a GitHub token pasted into every browser it was used
 * from, and then a deploy before the live site had it. Now the server
 * does it:
 *
 *   1. The caller must be a super admin. Their Supabase access token is
 *      handed to Supabase, which answers is_super_admin() for them; it is
 *      not trusted as read here. (Same pattern as employee-file.php.)
 *   2. The live template is copied to a backup folder above the web root
 *      (<home>/ienergy-form-backups/<page>/<name>/), the last 30 kept, so
 *      any replace can be undone by hand from cPanel's File Manager.
 *   3. The new file is written over the live one -- beside it and renamed
 *      over it, so nobody opening the form gets half a file. It is live
 *      at once; no deploy is needed.
 *   4. <page>/templates/versions.json gets a new stamp for the file. The
 *      documents pages add it to the template's address, so a cache in
 *      front of the site (Cloudflare) cannot go on serving the old one.
 *   5. If the server has a GitHub token (form-designer-config.php, written
 *      by the "Deploy to cPanel" workflow from the repository secret
 *      FORM_DESIGNER_GITHUB_TOKEN), the same file is committed to GitHub
 *      too, so the repository keeps the live form. Without one the live
 *      site still has it; the answer says GitHub was not updated.
 *
 * Only a template that already exists can be replaced, and only a Word
 * file, so nothing else on the site can be written through this.
 * ===================================================================== */

declare(strict_types=1);

const SUPABASE_URL = 'https://ednaedkurjsgvjrvayys.supabase.co';
// The public anon key, the same one the pages carry.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkbmFlZGt1cmpzZ3ZqcnZheXlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5ODIzNzYsImV4cCI6MjEwNzU1ODM3Nn0.VvBg4YtwZsjmgmTxbf3vin3Oq_WyNTeioz6m-FRQLzA';
const MAX_BYTES = 15 * 1024 * 1024;
const BACKUP_FOLDER = 'ienergy-form-backups';
const KEEP_BACKUPS = 30;
const PAGES = ['hr' => 'hr-documents', 'employee' => 'employee-documents'];
const REPO = 'ahmedm838/ienergy-portal';
const BRANCH = 'main';

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function fail(int $status, string $message): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $message]);
    exit;
}

function json_out(array $data): void {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES);
    exit;
}

function token(): string {
    $candidates = [
        $_SERVER['HTTP_AUTHORIZATION'] ?? '',
        $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '',
        $_SERVER['HTTP_X_SUPABASE_TOKEN'] ?? '',
    ];
    foreach ($candidates as $value) {
        $value = trim((string)$value);
        if (stripos($value, 'Bearer ') === 0) $value = trim(substr($value, 7));
        if ($value !== '' && preg_match('/^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/', $value)) {
            return $value;
        }
    }
    return '';
}

/** A request to Supabase as the caller. [status, decoded body] */
function supabase(string $method, string $path, string $jwt, ?string $body = null): array {
    $ch = curl_init(SUPABASE_URL . $path);
    $headers = ['apikey: ' . SUPABASE_ANON_KEY, 'Authorization: Bearer ' . $jwt, 'Accept: application/json'];
    if ($body !== null) $headers[] = 'Content-Type: application/json';
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_CONNECTTIMEOUT => 8,
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $raw = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($raw === false) return [0, null];
    return [$status, json_decode((string)$raw, true)];
}

/** A request to GitHub's API with the server's token. [status, decoded body] */
function github(string $method, string $path, string $token, ?array $body = null): array {
    $ch = curl_init('https://api.github.com' . $path);
    $headers = [
        'Accept: application/vnd.github+json',
        'Authorization: Bearer ' . $token,
        'X-GitHub-Api-Version: 2022-11-28',
        'User-Agent: ienergy-portal-form-designer',
    ];
    if ($body !== null) $headers[] = 'Content-Type: application/json';
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_CONNECTTIMEOUT => 8,
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    $raw = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($raw === false) return [0, null];
    return [$status, json_decode((string)$raw, true)];
}

/** The repository commit, when the server has a token. Never fails the
    replace: the live file is already written by then. */
function commit_to_github(string $repoPath, string $bytes, string $message): array {
    $config = __DIR__ . '/form-designer-config.php';
    $token = '';
    if (is_file($config)) {
        $c = include $config;
        if (is_array($c)) $token = trim((string)($c['github_token'] ?? ''));
    }
    if ($token === '') return ['updated' => false, 'reason' => 'no-token'];

    $url = '/repos/' . REPO . '/contents/' . implode('/', array_map('rawurlencode', explode('/', $repoPath)));
    [$status, $current] = github('GET', $url . '?ref=' . BRANCH, $token);
    if ($status !== 200 && $status !== 404) return ['updated' => false, 'reason' => "GitHub answered $status"];
    $body = ['message' => $message, 'content' => base64_encode($bytes), 'branch' => BRANCH];
    if ($status === 200 && !empty($current['sha'])) {
        // Already the same file (a replace with no changes): nothing to commit.
        if (($current['sha'] ?? '') === sha1('blob ' . strlen($bytes) . "\0" . $bytes)) {
            return ['updated' => true, 'commit' => null, 'unchanged' => true];
        }
        $body['sha'] = $current['sha'];
    }
    [$status, $done] = github('PUT', $url, $token, $body);
    if ($status !== 200 && $status !== 201) {
        $why = $status === 401 ? 'the server\'s GitHub token is not valid or has expired'
            : ($status === 403 || $status === 404 ? 'the server\'s GitHub token cannot write to the repository'
            : "GitHub answered $status");
        return ['updated' => false, 'reason' => $why];
    }
    return ['updated' => true, 'commit' => substr((string)($done['commit']['sha'] ?? ''), 0, 7)];
}

/* ---- Who is asking ------------------------------------------------- */

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') fail(405, 'Method not allowed.');

$jwt = token();
if ($jwt === '') fail(401, 'Not signed in.');

[$status, $isSuper] = supabase('POST', '/rest/v1/rpc/is_super_admin', $jwt, '{}');
if ($status === 401) fail(401, 'Your sign-in has expired. Sign in again on iEnergy Home.');
if ($status !== 200) fail(502, 'Could not check your access with the database.');
if ($isSuper !== true) fail(403, 'Only super admins can replace form templates.');

// Who, for the backup's name and the commit message. Not needed for
// access, so a failure here changes nothing.
$who = '';
[$status, $user] = supabase('GET', '/auth/v1/user', $jwt);
if ($status === 200 && !empty($user['id']) && preg_match('/^[0-9a-f-]{36}$/', (string)$user['id'])) {
    [$status, $rows] = supabase('GET', '/rest/v1/employees?select=name,code&auth_user_id=eq.' . $user['id'], $jwt);
    if ($status === 200 && is_array($rows) && count($rows) === 1) {
        $who = trim((string)($rows[0]['name'] ?? ''));
        $code = preg_replace('/[^A-Za-z0-9_-]/', '', (string)($rows[0]['code'] ?? ''));
    }
}

/* ---- Which template ------------------------------------------------ */

$page = (string)($_GET['page'] ?? '');
if (!isset(PAGES[$page])) fail(400, 'Unknown page.');
$template = (string)($_GET['template'] ?? '');
$template = explode('?', $template)[0];
if (!preg_match('#^templates/([a-z0-9][a-z0-9-]*\.docx)$#', $template, $m)) fail(400, 'Not a form template.');
$name = $m[1];

$root = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
if ($root === '') fail(500, 'Server misconfigured: no document root.');
// The site root is the folder above this one. Using it rather than
// DOCUMENT_ROOT keeps this right if the portal ever sits in a subfolder.
$site = dirname(__DIR__);
$dir = $site . '/' . PAGES[$page] . '/templates';
$path = $dir . '/' . $name;
if (!is_file($path)) fail(404, 'That form has no template on the server to replace.');

/* ---- The new file -------------------------------------------------- */

$bytes = (string)file_get_contents('php://input', false, null, 0, MAX_BYTES + 1);
if ($bytes === '') fail(400, 'No file arrived. It may be larger than the server allows.');
if (strlen($bytes) > MAX_BYTES) fail(413, 'The file is larger than 15 MB.');
if (substr($bytes, 0, 4) !== "PK\x03\x04") fail(415, 'That is not a Word (.docx) file.');
if (class_exists('ZipArchive')) {
    $probe = tempnam(sys_get_temp_dir(), 'fd');
    file_put_contents($probe, $bytes);
    $zip = new ZipArchive();
    $ok = $zip->open($probe) === true && $zip->locateName('word/document.xml') !== false;
    if ($ok) $zip->close();
    @unlink($probe);
    if (!$ok) fail(415, 'That is not a Word (.docx) file.');
}

/* ---- Back up the live one ------------------------------------------ */

$backupDir = dirname($root) . '/' . BACKUP_FOLDER . '/' . $page . '/' . pathinfo($name, PATHINFO_FILENAME);
if (!is_dir($backupDir) && !@mkdir($backupDir, 0700, true) && !is_dir($backupDir)) {
    fail(500, 'Could not create the backup folder on the server.');
}
@file_put_contents(dirname($root) . '/' . BACKUP_FOLDER . '/.htaccess', "Require all denied\n");
$stamp = gmdate('Ymd-His');
$backup = $backupDir . '/' . $stamp . (!empty($code) ? '-' . $code : '') . '.docx';
if (!@copy($path, $backup)) fail(500, 'Could not back up the current template, so it was not replaced.');
$old = glob($backupDir . '/*.docx') ?: [];
sort($old);
foreach (array_slice($old, 0, max(0, count($old) - KEEP_BACKUPS)) as $f) @unlink($f);

/* ---- Write the new one --------------------------------------------- */

$tmp = $path . '.replacing';
if (@file_put_contents($tmp, $bytes) !== strlen($bytes)) {
    @unlink($tmp);
    fail(500, 'Could not write the template on the server.');
}
@chmod($tmp, 0644);
if (!@rename($tmp, $path)) {
    @unlink($tmp);
    fail(500, 'Could not write the template on the server.');
}
clearstatcache(true, $path);

// A new address for the file, so no cache serves the old one.
$versionsPath = $dir . '/versions.json';
$versions = is_file($versionsPath) ? json_decode((string)file_get_contents($versionsPath), true) : [];
if (!is_array($versions)) $versions = [];
$versions[$template] = substr(sha1($bytes), 0, 10);
$vtmp = $versionsPath . '.writing';
if (@file_put_contents($vtmp, json_encode($versions, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)) !== false) {
    @chmod($vtmp, 0644);
    @rename($vtmp, $versionsPath);
}

/* ---- And GitHub, when the server can ------------------------------- */

$message = 'Replace form template ' . PAGES[$page] . '/' . $template
    . ($who !== '' ? ' — by ' . $who : '')
    . "\n\nReplaced from the Form Designer; already live on the portal.";
$github = commit_to_github(PAGES[$page] . '/' . $template, $bytes, $message);

json_out([
    'ok' => true,
    'stamp' => $versions[$template],
    'backup' => basename($backup),
    'github' => $github,
]);
