<?php

header('Content-Type: application/json');

$databaseDir = realpath(__DIR__ . '/../../database');
$criticalNotesPath = $databaseDir ? $databaseDir . DIRECTORY_SEPARATOR . 'Buildbooks_CRITICAL_NOTES.csv' : null;
$lockPath = __DIR__ . DIRECTORY_SEPARATOR . 'critical-notes-admin.lock';

$requestMethod = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';
if ($requestMethod !== 'POST') {
	sendJson(false, 'POST is required.', 405);
}

if ($criticalNotesPath === false || $criticalNotesPath === null || !is_file($criticalNotesPath)) {
	sendJson(false, 'Critical notes file was not found.', 500);
}

$sku = getRequiredSku();
$coinLabel = getFlag('coin_label');
$batteryIcon = $coinLabel ? true : getFlag('battery_icon');
$fccLabel = getFlag('fcc_label');
$criticalNote = getCriticalNoteHtml();

$batteryWarning = '';
if ($coinLabel) {
	$batteryWarning = 'COIN';
} else if ($batteryIcon) {
	$batteryWarning = 'BATTERY';
}
$fcc = $fccLabel ? 'FCC' : '';
$shouldKeepRow = $batteryWarning !== '' || $fcc !== '' || $criticalNote !== '';

$lock = openLock($lockPath);
$rows = readCriticalNotesRows($criticalNotesPath);
$found = false;
$outRows = array();

foreach ($rows as $row) {
	if ($row['LocalSKU'] === $sku) {
		$found = true;
		if ($shouldKeepRow) {
			$outRows[] = makeRow($sku, $batteryWarning, $fcc, $criticalNote);
		}
	} else {
		$outRows[] = $row;
	}
}

if (!$found && $shouldKeepRow) {
	$outRows[] = makeRow($sku, $batteryWarning, $fcc, $criticalNote);
}

if (!writeCriticalNotesRows($criticalNotesPath, $outRows)) {
	closeLock($lock);
	sendJson(false, 'Could not write critical notes file.', 500);
}

closeLock($lock);

$responseRow = $shouldKeepRow ? makeRow($sku, $batteryWarning, $fcc, $criticalNote) : null;
sendJson(true, $shouldKeepRow ? 'Label rules saved.' : 'Label rules cleared.', 200, array(
	'sku' => $sku,
	'row' => $responseRow
));

function getRequiredSku() {
	$sku = isset($_POST['sku']) ? trim($_POST['sku']) : '';
	if ($sku === '') {
		sendJson(false, 'SKU is required.', 400);
	}
	if (strlen($sku) > 120 || preg_match('/[\r\n\t]/', $sku)) {
		sendJson(false, 'SKU contains invalid characters.', 400);
	}
	return $sku;
}

function getFlag($name) {
	$value = isset($_POST[$name]) ? trim($_POST[$name]) : '0';
	if ($value !== '0' && $value !== '1') {
		sendJson(false, 'Invalid label rule flag.', 400);
	}
	return $value === '1';
}

function getCriticalNoteHtml() {
	$note = isset($_POST['critical_note']) ? $_POST['critical_note'] : '';
	if (!is_string($note)) {
		sendJson(false, 'Critical note was not readable.', 400);
	}
	if (strlen($note) > 2000) {
		sendJson(false, 'Critical note is too long.', 400);
	}

	$note = str_replace(array("\r\n", "\r"), "\n", $note);
	$note = str_replace("\t", ' ', $note);
	$note = trim($note);

	if ($note === '') {
		return '';
	}

	$escaped = htmlspecialchars($note, ENT_QUOTES, 'UTF-8');
	return str_replace("\n", '<br>', $escaped);
}

function readCriticalNotesRows($path) {
	$handle = fopen($path, 'rb');
	if (!$handle) {
		sendJson(false, 'Could not open critical notes file.', 500);
	}

	$header = fgets($handle);
	if ($header === false) {
		fclose($handle);
		sendJson(false, 'Critical notes file is empty.', 500);
	}

	$headers = explode("\t", cleanLine($header));
	$expected = array('LocalSKU', 'BatteryWarning', 'FCC', 'CriticalNote');
	if ($headers !== $expected) {
		fclose($handle);
		sendJson(false, 'Critical notes header is not recognized.', 500);
	}

	$rows = array();
	while (($line = fgets($handle)) !== false) {
		$line = cleanLine($line);
		if (trim($line) === '') {
			continue;
		}
		$columns = explode("\t", $line);
		while (count($columns) < count($headers)) {
			$columns[] = '';
		}
		$rows[] = array(
			'LocalSKU' => isset($columns[0]) ? $columns[0] : '',
			'BatteryWarning' => isset($columns[1]) ? $columns[1] : '',
			'FCC' => isset($columns[2]) ? $columns[2] : '',
			'CriticalNote' => isset($columns[3]) ? $columns[3] : ''
		);
	}

	fclose($handle);
	return $rows;
}

function writeCriticalNotesRows($path, $rows) {
	$content = "LocalSKU\tBatteryWarning\tFCC\tCriticalNote\r\n";
	foreach ($rows as $row) {
		if (!isValidExistingRow($row)) {
			continue;
		}
		$content .= cleanField($row['LocalSKU']) . "\t" . cleanField($row['BatteryWarning']) . "\t" . cleanField($row['FCC']) . "\t" . cleanField($row['CriticalNote']) . "\r\n";
	}
	return file_put_contents($path, $content, LOCK_EX) !== false;
}

function isValidExistingRow($row) {
	if (!isset($row['LocalSKU']) || $row['LocalSKU'] === '') {
		return false;
	}
	if ($row['BatteryWarning'] !== '' && $row['BatteryWarning'] !== 'BATTERY' && $row['BatteryWarning'] !== 'COIN') {
		return false;
	}
	if ($row['FCC'] !== '' && $row['FCC'] !== 'FCC') {
		return false;
	}
	return true;
}

function makeRow($sku, $batteryWarning, $fcc, $criticalNote) {
	return array(
		'LocalSKU' => $sku,
		'BatteryWarning' => $batteryWarning,
		'FCC' => $fcc,
		'CriticalNote' => $criticalNote
	);
}

function cleanLine($line) {
	return rtrim($line, "\r\n");
}

function cleanField($value) {
	$value = (string)$value;
	$value = str_replace(array("\r", "\n", "\t"), ' ', $value);
	return $value;
}

function openLock($lockPath) {
	$lock = fopen($lockPath, 'c');
	if (!$lock || !flock($lock, LOCK_EX)) {
		sendJson(false, 'Could not lock critical notes file.', 500);
	}
	return $lock;
}

function closeLock($lock) {
	if ($lock) {
		flock($lock, LOCK_UN);
		fclose($lock);
	}
}

function sendJson($ok, $message, $status = 200, $extra = array()) {
	http_response_code($status);
	echo json_encode(array_merge(array(
		'ok' => $ok,
		'message' => $message
	), $extra));
	exit;
}

?>
