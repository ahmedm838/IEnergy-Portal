<?php
/* =====================================================================
 * One PDF per employee, kept on the cPanel server.
 *
 * Used by the Employee Database page ("Employee documents" section).
 * Stored here rather than in Supabase Storage to keep the Supabase free
 * tier's quota for the database.
 *
 *   GET  ?id=<uuid>&action=status   {"exists":bool,"size":n,"updated":"ISO"}
 *   GET  ?id=<uuid>                 the PDF itself (inline)
 *   POST ?id=<uuid>  (file=<pdf>)   upload, or replace the one there
 *
 * Who may: admins and super admins only. The caller sends their Supabase
 * access token (Authorization: Bearer ..., or X-Supabase-Token, because
 * some Apache/PHP setups drop the Authorization header). The token is
 * not trusted as read here: it is handed to Supabase, which checks its
 * signature and answers is_admin() for that user. The employee id is
 * then looked up with the same token, so row level security decides
 * whether the record exists for this caller.
 *
 * Where: <home>/ienergy-employee-files/<employee uuid>.pdf -- one level
 * ABOVE the document root, so the files cannot be fetched by URL; the
 * only way to them is through this script. The folder is created on
 * first use, readable by the account alone.
 * ===================================================================== */

declare(strict_types=1);

const SUPABASE_URL = 'https://ednaedkurjsgvjrvayys.supabase.co';
// The public anon key, the same one the pages carry. It identifies the
// project; it grants nothing the caller's own token does not.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkbmFlZGt1cmpzZ3ZqcnZheXlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5ODIzNzYsImV4cCI6MjEwNzU1ODM3Nn0.VvBg4YtwZsjmgmTxbf3vin3Oq_WyNTeioz6m-FRQLzA';
const MAX_BYTES = 25 * 1024 * 1024;
const FOLDER_NAME = 'ienergy-employee-files';

header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function fail(int $status, string $message): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $message]);
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

/** A request to Supabase's REST API as the caller. [status, decoded body] */
function supabase(string $method, string $path, string $jwt, ?string $body = null): array {
    $ch = curl_init(SUPABASE_URL . $path);
    $headers = [
        'apikey: ' . SUPABASE_ANON_KEY,
        'Authorization: Bearer ' . $jwt,
        'Accept: application/json',
    ];
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

function folder(): string {
    $root = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
    if ($root === '') fail(500, 'Server misconfigured: no document root.');
    $dir = dirname($root) . '/' . FOLDER_NAME;
    if (!is_dir($dir)) {
        if (!@mkdir($dir, 0700, true) && !is_dir($dir)) {
            fail(500, 'Could not create the documents folder on the server.');
        }
        // Belt and braces: if the folder is ever moved under a web root,
        // Apache still refuses to serve it.
        @file_put_contents($dir . '/.htaccess', "Require all denied\n");
    }
    return $dir;
}

/* ---- Who is asking ------------------------------------------------- */

$jwt = token();
if ($jwt === '') fail(401, 'Not signed in.');

[$status, $isAdmin] = supabase('POST', '/rest/v1/rpc/is_admin', $jwt, '{}');
if ($status === 401) fail(401, 'Your sign-in has expired. Sign in again on iEnergy Home.');
if ($status !== 200) fail(502, 'Could not check your access with the database.');
if ($isAdmin !== true) fail(403, 'Only admins can manage employee documents.');

/* ---- Which employee ------------------------------------------------ */

$id = strtolower((string)($_GET['id'] ?? ''));
if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $id)) {
    fail(400, 'Missing or invalid employee id.');
}
[$status, $rows] = supabase('GET', '/rest/v1/employees?select=id&id=eq.' . $id, $jwt);
if ($status !== 200) fail(502, 'Could not check the employee with the database.');
if (!is_array($rows) || count($rows) !== 1) fail(404, 'No such employee.');

$path = folder() . '/' . $id . '.pdf';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

/* ---- Status -------------------------------------------------------- */

if ($method === 'GET' && ($_GET['action'] ?? '') === 'status') {
    header('Content-Type: application/json; charset=utf-8');
    clearstatcache(true, $path);
    if (!is_file($path)) {
        echo json_encode(['exists' => false]);
    } else {
        echo json_encode([
            'exists' => true,
            'size' => filesize($path),
            'updated' => gmdate('c', (int)filemtime($path)),
        ]);
    }
    exit;
}

/* ---- View ---------------------------------------------------------- */

if ($method === 'GET') {
    if (!is_file($path)) fail(404, 'No document uploaded for this employee yet.');
    header('Content-Type: application/pdf');
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: inline; filename="employee-' . $id . '.pdf"');
    readfile($path);
    exit;
}

/* ---- Upload / replace ---------------------------------------------- */

if ($method === 'POST') {
    $file = $_FILES['file'] ?? null;
    if (!$file || !isset($file['error'])) {
        // An upload larger than post_max_size arrives with no $_FILES at all.
        fail(413, 'No file arrived. It may be larger than the server allows.');
    }
    if ($file['error'] === UPLOAD_ERR_INI_SIZE || $file['error'] === UPLOAD_ERR_FORM_SIZE) {
        fail(413, 'The file is larger than the server allows.');
    }
    if ($file['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
        fail(400, 'The upload did not complete. Try again.');
    }
    if ($file['size'] > MAX_BYTES) fail(413, 'The file is larger than 25 MB.');

    $head = (string)file_get_contents($file['tmp_name'], false, null, 0, 5);
    if ($head !== '%PDF-') fail(415, 'Only PDF files can be uploaded.');

    // Written beside the target and renamed over it, so a viewer never
    // gets half a file and a failed replace leaves the old one intact.
    $tmp = $path . '.uploading';
    if (!move_uploaded_file($file['tmp_name'], $tmp)) fail(500, 'Could not save the file on the server.');
    @chmod($tmp, 0600);
    if (!rename($tmp, $path)) {
        @unlink($tmp);
        fail(500, 'Could not save the file on the server.');
    }
    clearstatcache(true, $path);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'exists' => true,
        'size' => filesize($path),
        'updated' => gmdate('c', (int)filemtime($path)),
    ]);
    exit;
}

fail(405, 'Method not allowed.');
