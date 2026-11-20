<?php
/* =====================================================================
 * Personnel file attachments, kept on the cPanel server.
 *
 * Used by the Employee Database page: each box in "Personnel file" has
 * its own PDF, with Upload / Replace, View and Delete beside it. Stored
 * here rather than in Supabase Storage to keep the Supabase free tier's
 * quota for the database.
 *
 *   GET    ?id=<uuid>&action=status   {"files":{"doc_contract":{"size":n,"updated":"ISO"},...}}
 *   GET    ?id=<uuid>&doc=<key>       the PDF itself (inline)
 *   POST   ?id=<uuid>&doc=<key>       upload, or replace (field "file")
 *   DELETE ?id=<uuid>&doc=<key>       remove it
 *
 * The box is the record of the file: an upload sets the employee's
 * doc_<key> flag to true and a delete sets it to false, here on the
 * server, so the tick and the file cannot drift apart. The page does not
 * let anyone tick or untick by hand.
 *
 * Who may: admins and super admins only. The caller sends their Supabase
 * access token (Authorization: Bearer ..., or X-Supabase-Token, because
 * some Apache/PHP setups drop the Authorization header). The token is
 * not trusted as read here: it is handed to Supabase, which checks its
 * signature and answers is_admin() for that user. The employee is then
 * read, and the flag written, with that same token, so row level
 * security has the final say.
 *
 * Where: <home>/ienergy-employee-files/<employee uuid>/<key>.pdf -- above
 * the document root, so no file can be fetched by URL; the only way to
 * them is through this script. Folders are created on first use,
 * readable by the account alone.
 * ===================================================================== */

declare(strict_types=1);

const SUPABASE_URL = 'https://ednaedkurjsgvjrvayys.supabase.co';
// The public anon key, the same one the pages carry. It identifies the
// project; it grants nothing the caller's own token does not.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkbmFlZGt1cmpzZ3ZqcnZheXlzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5ODIzNzYsImV4cCI6MjEwNzU1ODM3Nn0.VvBg4YtwZsjmgmTxbf3vin3Oq_WyNTeioz6m-FRQLzA';
const MAX_BYTES = 25 * 1024 * 1024;
const FOLDER_NAME = 'ienergy-employee-files';

/* The personnel file, as on the page. Nothing else is accepted, which
   also keeps the file name safe. */
const DOCS = [
    'doc_graduation_certificate', 'doc_military_certificate', 'doc_birth_certificate',
    'doc_criminal_clearance', 'doc_id_copy', 'doc_personal_photos', 'doc_medical_form_111',
    'doc_si_record_copy', 'doc_si_form_1', 'doc_contract',
];

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
    echo json_encode($data, JSON_FORCE_OBJECT);
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
function supabase(string $method, string $path, string $jwt, ?string $body = null, array $extra = []): array {
    $ch = curl_init(SUPABASE_URL . $path);
    $headers = array_merge([
        'apikey: ' . SUPABASE_ANON_KEY,
        'Authorization: Bearer ' . $jwt,
        'Accept: application/json',
    ], $extra);
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

/** Tick or untick the box for this document. */
function set_flag(string $id, string $doc, bool $value, string $jwt): bool {
    [$status, $rows] = supabase(
        'PATCH',
        '/rest/v1/employees?id=eq.' . $id . '&select=id',
        $jwt,
        json_encode([$doc => $value]),
        ['Prefer: return=representation']
    );
    return $status === 200 && is_array($rows) && count($rows) === 1;
}

/** Write a file event to the change log, as the signed-in user. A log
    line that cannot be written does not undo the upload. */
function log_file_event(string $id, string $doc, string $action, string $jwt): void {
    [$status] = supabase(
        'POST',
        '/rest/v1/rpc/log_employee_file',
        $jwt,
        json_encode(['p_employee_id' => $id, 'p_doc' => $doc, 'p_action' => $action])
    );
    if ($status < 200 || $status >= 300) error_log("log_employee_file failed ($status) for $id/$doc");
}

function make_dir(string $dir): void {
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) {
        fail(500, 'Could not create the documents folder on the server.');
    }
}

function info(string $path): array {
    clearstatcache(true, $path);
    return ['size' => filesize($path), 'updated' => gmdate('c', (int)filemtime($path))];
}

/* ---- Who is asking ------------------------------------------------- */

$jwt = token();
if ($jwt === '') fail(401, 'Not signed in.');

[$status, $isAdmin] = supabase('POST', '/rest/v1/rpc/is_admin', $jwt, '{}');
if ($status === 401) fail(401, 'Your sign-in has expired. Sign in again on iEnergy Home.');
if ($status !== 200) fail(502, 'Could not check your access with the database.');
if ($isAdmin !== true) fail(403, 'Only admins can manage employee documents.');

/* ---- Which employee, which document -------------------------------- */

$id = strtolower((string)($_GET['id'] ?? ''));
if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $id)) {
    fail(400, 'Missing or invalid employee id.');
}
[$status, $rows] = supabase('GET', '/rest/v1/employee_profiles?select=id,gender&id=eq.' . $id, $jwt);
if ($status !== 200) fail(502, 'Could not check the employee with the database.');
if (!is_array($rows) || count($rows) !== 1) fail(404, 'No such employee.');
$female = ($rows[0]['gender'] ?? null) === 'Female';

$root = rtrim((string)($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
if ($root === '') fail(500, 'Server misconfigured: no document root.');
$base = dirname($root) . '/' . FOLDER_NAME;
$dir = $base . '/' . $id;
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

/* ---- Status: which boxes have a file ------------------------------- */

if ($method === 'GET' && ($_GET['action'] ?? '') === 'status') {
    $files = [];
    foreach (DOCS as $doc) {
        $path = $dir . '/' . $doc . '.pdf';
        if (is_file($path)) $files[$doc] = info($path);
    }
    json_out(['files' => $files]);
}

$doc = (string)($_GET['doc'] ?? '');
if (!in_array($doc, DOCS, true)) fail(400, 'Unknown document.');
$path = $dir . '/' . $doc . '.pdf';

/* ---- View ---------------------------------------------------------- */

if ($method === 'GET') {
    if (!is_file($path)) fail(404, 'No file uploaded for this document.');
    header('Content-Type: application/pdf');
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: inline; filename="' . $doc . '.pdf"');
    readfile($path);
    exit;
}

/* ---- Upload / replace ---------------------------------------------- */

if ($method === 'POST') {
    if ($doc === 'doc_military_certificate' && $female) {
        fail(409, 'Military service does not apply: the ID No. is a female one.');
    }
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

    if (!is_dir($base)) {
        make_dir($base);
        // If the folder is ever moved under a web root, Apache still
        // refuses to serve it.
        @file_put_contents($base . '/.htaccess', "Require all denied\n");
    }
    make_dir($dir);

    // Written beside the target and renamed over it, so a viewer never
    // gets half a file and a failed replace leaves the old one intact.
    // A file already there is being replaced: no box changes for that,
    // so the change log hears it from here (log_employee_file).
    $replacing = is_file($path);
    $tmp = $path . '.uploading';
    if (!move_uploaded_file($file['tmp_name'], $tmp)) fail(500, 'Could not save the file on the server.');
    @chmod($tmp, 0600);
    if (!rename($tmp, $path)) {
        @unlink($tmp);
        fail(500, 'Could not save the file on the server.');
    }
    if (!set_flag($id, $doc, true, $jwt)) {
        fail(502, 'The file was saved, but the box could not be ticked. Try uploading again.');
    }
    if ($replacing) log_file_event($id, $doc, 'replaced', $jwt);
    json_out(['file' => info($path), 'checked' => true]);
}

/* ---- Delete -------------------------------------------------------- */

if ($method === 'DELETE') {
    if (is_file($path) && !@unlink($path)) fail(500, 'Could not delete the file on the server.');
    @rmdir($dir); // only succeeds once the folder is empty
    if (!set_flag($id, $doc, false, $jwt)) {
        fail(502, 'The file was deleted, but the box could not be unticked. Try again.');
    }
    json_out(['file' => null, 'checked' => false]);
}

fail(405, 'Method not allowed.');
