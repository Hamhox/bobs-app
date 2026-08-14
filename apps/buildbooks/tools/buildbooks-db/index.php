<?php

$databaseDir = realpath(__DIR__ . '/../../database');
$archiveDir = $databaseDir ? $databaseDir . DIRECTORY_SEPARATOR . 'archive' : null;

$files = array(
	'bom' => array(
		'label' => 'Buildbooks BOM',
		'shortLabel' => 'BOM',
		'input' => 'bom_file',
		'liveName' => 'buildbooks-bom.tsv',
		'headers' => array('AssemblySKU', 'PartSKU', 'Quantity')
	),
	'inventory' => array(
		'label' => 'Buildbooks Inventory',
		'shortLabel' => 'Inventory',
		'input' => 'inventory_file',
		'liveName' => 'buildbooks-inventory.tsv',
		'headers' => array('LocalSKU', 'ItemName', 'Vendor', 'UPC'),
		'optionalTrailingHeaders' => array('ProductType', 'COO')
	),
	'metadata' => array(
		'label' => 'Buildbooks Item Metadata',
		'shortLabel' => 'Metadata',
		'input' => 'metadata_file',
		'liveName' => 'buildbooks-item-metadata.tsv',
		'headers' => array('LocalSKU', 'StockUOM', 'UnitWeightLb', 'Stowage', 'HistoricalBasis', 'Confidence', 'SourceCode', 'HazardClass', 'LabelTemplate', 'Notes')
	)
);

$result = array(
	'ran' => false,
	'ok' => false,
	'messages' => array(),
	'errors' => array(),
	'validation' => array(),
	'archives' => array(),
	'publishedAt' => ''
);

$currentLive = getCurrentLiveData($files, $databaseDir);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
	$result['ran'] = true;
	$result = handleUpload($files, $databaseDir, $archiveDir, $result);
}

function handleUpload($files, $databaseDir, $archiveDir, $result) {
	if ($databaseDir === false || $databaseDir === null || !is_dir($databaseDir)) {
		$result['errors'][] = 'Database folder was not found.';
		return $result;
	}

	$uploads = array();

	foreach ($files as $key => $fileDef) {
		$upload = validateUpload($fileDef);
		if (!$upload['ok']) {
			$result['errors'] = array_merge($result['errors'], $upload['errors']);
			continue;
		}

		$optionalTrailingHeaders = isset($fileDef['optionalTrailingHeaders']) ? $fileDef['optionalTrailingHeaders'] : array();
		$structure = validateTsvFile($upload['tmpName'], $fileDef['headers'], $fileDef['label'], $optionalTrailingHeaders);
		$result['validation'][$key] = $structure;
		if (!$structure['ok']) {
			$result['errors'] = array_merge($result['errors'], $structure['errors']);
			continue;
		}

		$upload['livePath'] = $databaseDir . DIRECTORY_SEPARATOR . $fileDef['liveName'];
		$upload['stagePath'] = $databaseDir . DIRECTORY_SEPARATOR . '.' . $fileDef['liveName'] . '.upload-' . date('Ymd-His') . '-' . mt_rand(1000, 9999) . '.tmp';
		$uploads[$key] = $upload;
	}

	if (count($uploads) !== count($files)) {
		$result['errors'][] = 'Nothing was changed. All files must pass validation before upload.';
		return $result;
	}

	foreach ($uploads as $key => $upload) {
		if (!move_uploaded_file($upload['tmpName'], $upload['stagePath'])) {
			$result['errors'][] = $upload['label'] . ' could not be moved into staging. Nothing live was changed.';
			cleanupStages($uploads);
			return $result;
		}
	}

	if (!is_dir($archiveDir) && !mkdir($archiveDir, 0755, true)) {
		$result['errors'][] = 'Archive folder could not be created. Nothing live was changed.';
		cleanupStages($uploads);
		return $result;
	}

	$archivePaths = array();
	foreach ($uploads as $key => $upload) {
		if (!is_file($upload['livePath'])) {
			$result['errors'][] = $upload['label'] . ' live file was not found. Nothing live was changed.';
			cleanupStages($uploads);
			return $result;
		}
		$archivePaths[$key] = nextArchivePath($upload['livePath'], $archiveDir);
	}

	$archived = array();
	foreach ($uploads as $key => $upload) {
		if (!rename($upload['livePath'], $archivePaths[$key])) {
			$result['errors'][] = $upload['label'] . ' could not be moved to archive. Upload was stopped.';
			rollbackArchives($archived);
			cleanupStages($uploads);
			return $result;
		}
		$archived[$key] = array(
			'archivePath' => $archivePaths[$key],
			'livePath' => $upload['livePath']
		);
		$result['archives'][$key] = basename($archivePaths[$key]);
	}

	$installed = array();
	foreach ($uploads as $key => $upload) {
		if (!rename($upload['stagePath'], $upload['livePath'])) {
			$result['errors'][] = $upload['label'] . ' could not be installed. Attempted to restore archived files.';
			rollbackInstalled($installed);
			rollbackArchives($archived);
			cleanupStages($uploads);
			return $result;
		}
		$installed[$key] = $upload['livePath'];
	}

	$result['ok'] = true;
	$result['publishedAt'] = formatPacificTime();
	$result['messages'][] = 'Upload complete. All live data files were replaced.';
	return $result;
}

function validateUpload($fileDef) {
	$result = array(
		'ok' => false,
		'label' => $fileDef['label'],
		'tmpName' => '',
		'errors' => array()
	);

	if (!isset($_FILES[$fileDef['input']]) || !is_array($_FILES[$fileDef['input']])) {
		$result['errors'][] = $fileDef['label'] . ' file is required.';
		return $result;
	}

	$file = $_FILES[$fileDef['input']];
	if ($file['error'] !== UPLOAD_ERR_OK) {
		$result['errors'][] = $fileDef['label'] . ' upload failed: ' . uploadErrorMessage($file['error']);
		return $result;
	}

	if (!isset($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
		$result['errors'][] = $fileDef['label'] . ' upload was not accepted by PHP.';
		return $result;
	}

	if (!isset($file['size']) || (int)$file['size'] <= 0) {
		$result['errors'][] = $fileDef['label'] . ' upload is empty.';
		return $result;
	}

	$result['ok'] = true;
	$result['tmpName'] = $file['tmp_name'];
	return $result;
}

function validateTsvFile($path, $expectedHeaders, $label, $optionalTrailingHeaders = array()) {
	$result = array(
		'ok' => false,
		'label' => $label,
		'rows' => 0,
		'errors' => array()
	);

	$handle = fopen($path, 'rb');
	if (!$handle) {
		$result['errors'][] = $label . ' could not be opened for validation.';
		return $result;
	}

	$lineNumber = 0;
	$headerLine = fgets($handle);
	if ($headerLine === false) {
		fclose($handle);
		$result['errors'][] = $label . ' is empty.';
		return $result;
	}

	$lineNumber++;
	$headers = explode("\t", cleanTsvLine($headerLine));
	$requiredHeaderCount = count($expectedHeaders);
	$requiredHeaders = array_slice($headers, 0, $requiredHeaderCount);
	$trailingHeaders = array_slice($headers, $requiredHeaderCount);
	$unexpectedTrailingHeaders = array_diff($trailingHeaders, $optionalTrailingHeaders);
	$duplicateTrailingHeaders = count($trailingHeaders) !== count(array_unique($trailingHeaders));
	if ($requiredHeaders !== $expectedHeaders || count($headers) < $requiredHeaderCount || count($unexpectedTrailingHeaders) > 0 || $duplicateTrailingHeaders) {
		fclose($handle);
		$message = $label . ' header must start with: ' . implode("\t", $expectedHeaders);
		if (count($optionalTrailingHeaders) > 0) {
			$message .= '. Accepted optional trailing columns: ' . implode(', ', $optionalTrailingHeaders);
		}
		$result['errors'][] = $message . '.';
		return $result;
	}

	$expectedColumnCount = count($headers);
	while (($line = fgets($handle)) !== false) {
		$lineNumber++;
		$line = cleanTsvLine($line);

		if (trim($line) === '') {
			continue;
		}

		$columns = explode("\t", $line);
		$columnCount = count($columns);
		if ($columnCount !== $expectedColumnCount) {
			$result['errors'][] = $label . ' line ' . $lineNumber . ' has ' . $columnCount . ' columns; expected ' . $expectedColumnCount . '.';
			if (count($result['errors']) >= 20) {
				$result['errors'][] = $label . ' has more validation errors; stopped after the first 20.';
				break;
			}
		}

		$result['rows']++;
	}

	fclose($handle);

	if (count($result['errors']) > 0) {
		return $result;
	}

	if ($result['rows'] === 0) {
		$result['errors'][] = $label . ' has a header but no data rows.';
		return $result;
	}

	$result['ok'] = true;
	return $result;
}

function cleanTsvLine($line) {
	$line = rtrim($line, "\r\n");
	if (substr($line, 0, 3) === "\xEF\xBB\xBF") {
		$line = substr($line, 3);
	}
	if (strlen($line) >= 2 && substr($line, 0, 1) === '"' && substr($line, -1) === '"') {
		$line = substr($line, 1, -1);
	}
	return $line;
}

function nextArchivePath($livePath, $archiveDir) {
	$info = pathinfo($livePath);
	$stamp = date('Ymd', filemtime($livePath));
	$extension = isset($info['extension']) && $info['extension'] !== '' ? '.' . $info['extension'] : '';
	$baseName = $info['filename'] . '_' . $stamp;
	$path = $archiveDir . DIRECTORY_SEPARATOR . $baseName . $extension;
	$counter = 2;

	while (file_exists($path)) {
		$path = $archiveDir . DIRECTORY_SEPARATOR . $baseName . '_' . $counter . $extension;
		$counter++;
	}

	return $path;
}

function cleanupStages($uploads) {
	foreach ($uploads as $upload) {
		if (isset($upload['stagePath']) && is_file($upload['stagePath'])) {
			@unlink($upload['stagePath']);
		}
	}
}

function rollbackArchives($archived) {
	foreach (array_reverse($archived) as $item) {
		if (is_file($item['archivePath']) && !is_file($item['livePath'])) {
			@rename($item['archivePath'], $item['livePath']);
		}
	}
}

function rollbackInstalled($installed) {
	foreach ($installed as $livePath) {
		if (is_file($livePath)) {
			@unlink($livePath);
		}
	}
}

function uploadErrorMessage($code) {
	$messages = array(
		UPLOAD_ERR_INI_SIZE => 'file exceeds the server upload limit.',
		UPLOAD_ERR_FORM_SIZE => 'file exceeds the form upload limit.',
		UPLOAD_ERR_PARTIAL => 'file was only partially uploaded.',
		UPLOAD_ERR_NO_FILE => 'no file was uploaded.',
		UPLOAD_ERR_NO_TMP_DIR => 'server temporary folder is missing.',
		UPLOAD_ERR_CANT_WRITE => 'server could not write the uploaded file.',
		UPLOAD_ERR_EXTENSION => 'a PHP extension stopped the upload.'
	);

	return isset($messages[$code]) ? $messages[$code] : 'unknown upload error.';
}

function h($value) {
	return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8');
}

function formatPacificTime() {
	$published = new DateTime('now', new DateTimeZone('America/Los_Angeles'));
	return $published->format('F j, Y \a\t g:i A T');
}

function formatPacificTimestamp($timestamp) {
	$published = new DateTime('@' . $timestamp);
	$published->setTimezone(new DateTimeZone('America/Los_Angeles'));
	return $published->format('F j, Y \a\t g:i A T');
}

function getCurrentLiveData($files, $databaseDir) {
	$result = array(
		'ok' => false,
		'publishedAt' => '',
		'files' => array()
	);

	if ($databaseDir === false || $databaseDir === null || !is_dir($databaseDir)) {
		return $result;
	}

	$oldestTimestamp = null;
	foreach ($files as $key => $fileDef) {
		$path = $databaseDir . DIRECTORY_SEPARATOR . $fileDef['liveName'];
		if (!is_file($path)) {
			continue;
		}

		$timestamp = filemtime($path);
		$result['files'][$key] = array(
			'name' => $fileDef['liveName'],
			'publishedAt' => formatPacificTimestamp($timestamp)
		);

		if ($oldestTimestamp === null || $timestamp < $oldestTimestamp) {
			$oldestTimestamp = $timestamp;
		}
	}

	if ($oldestTimestamp !== null) {
		$result['ok'] = true;
		$result['publishedAt'] = formatPacificTimestamp($oldestTimestamp);
	}

	return $result;
}

?>
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Buildbooks DB Uptake</title>
	<link rel="icon" type="image/png" sizes="32x32" href="favicon-32x32.png">
	<link rel="icon" type="image/png" sizes="16x16" href="favicon-16x16.png">
	<link rel="shortcut icon" href="favicon.ico">
	<link rel="preconnect" href="https://fonts.gstatic.com">
	<link href="https://fonts.googleapis.com/css2?family=Sriracha&display=swap" rel="stylesheet">
	<link href="https://fonts.googleapis.com/css2?family=Miriam+Libre:wght@400;700&display=swap" rel="stylesheet">
	<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
	<link href="https://fonts.googleapis.com/css2?family=Rubik:wght@300..900&display=swap" rel="stylesheet">
	<link href="https://fonts.googleapis.com/css2?family=Host+Grotesk:wght@300..800&family=Rubik:wght@300..900&display=swap" rel="stylesheet">
	<style>
		body {
			margin: 0;
			background: #333 url("../../assets/60-lines.png");
			color: rgba(0, 0, 0, .75);
			font-family: 'Miriam Libre', Arial, Helvetica, sans-serif;
		}
		#topbar {
			position: fixed;
			left: 0;
			top: 0;
			background-color: hsl(220deg 18% 5% / 67%);
			background: radial-gradient(circle at 78% 50%, #0061bd73 0%, rgba(124, 20, 190, 0.48) 24%, rgba(40, 16, 104, 0.25) 46%, transparent 68%), linear-gradient(130deg, hsl(0deg 0% 0% / 69%) 56%, hsl(251deg 100% 20% / 87%) 66%, rgb(239 0 216 / 67%) 87%);
			height: 50px;
			z-index: 2;
			right: 0;
			width: 100%;
		}
		#armor-tech-logo {
			display: inline-block;
			left: 10px;
			top: 4px;
			position: relative;
		}
		#armor-tech-logo-svg {
			height: 38px;
		}
		#armor-tech-logo a {
			display: inline-block;
		}
		#newSiteLink {
			position: absolute;
			top: 10px;
			right: 10px;
			background: rgba(8, 18, 52, 0.55);
			border-left: 1px solid rgba(255, 255, 255, 0.16);
			padding: 2px 12px;
			border-radius: 3px;
			color: rgb(205 137 182 / 50%);
		}
		#newSiteLink a {
			color: hsl(220 10% 78% / 1);
			text-decoration: none;
			background-color: rgba(0,0,0,0);
			border: none;
			cursor: pointer;
			font-weight: 700;
			font-size: 10px;
		}
		#toolsMenuButton {
			width: 22px;
			height: 18px;
			padding: 0;
			margin: 0 0 0 2px;
			border: 0;
			background: rgba(0,0,0,0);
			vertical-align: middle;
			cursor: pointer;
		}
		#toolsMenuButton img {
			width: 18px;
			height: 18px;
			display: block;
			opacity: .85;
		}
		#toolsMenuButton:hover img,
		#toolsMenuButton:focus img {
			opacity: 1;
		}
		#toolsMenu {
			display: none;
			position: absolute;
			top: 27px;
			right: 0;
			min-width: 170px;
			padding: 6px 0;
			border: 1px solid rgba(255,255,255,.18);
			border-radius: 4px;
			background: rgba(22,23,28,.96);
			box-shadow: 0 8px 22px rgba(0,0,0,.28);
		}
		#toolsMenu.open {
			display: block;
		}
		#toolsMenu a {
			display: block;
			padding: 8px 12px;
			color: hsl(220 12% 88% / 1);
			font-size: 12px;
			text-decoration: none;
		}
		#toolsMenu a:hover,
		#toolsMenu a:focus {
			background: rgba(255,20,147,.18);
			color: #fff;
		}
		#main {
			box-sizing: border-box;
			max-width: 860px;
			margin: 70px auto;
			background: #fff url("../../assets/60-lines.png");
			border-radius: 4px;
			box-shadow: 0 0 0 1px rgba(0,0,0,.1), 0 2px 3px rgba(0,0,0,.2);
			padding: 36px;
		}
		h1 {
			margin: 0 0 8px 0;
			color: rgba(0,0,0,.9);
			font-size: 34px;
		}
		p {
			line-height: 1.45;
		}
		form {
			margin-top: 28px;
		}
		label {
			display: block;
			font-weight: 700;
			margin: 20px 0 8px 0;
		}
		input[type="file"] {
			box-sizing: border-box;
			width: 100%;
			padding: 10px;
			border: 1px solid #ccc;
			background: #fff;
		}
		button {
			margin-top: 26px;
			padding: 11px 18px;
			background: #1a57d2;
			border: 0;
			border-radius: 4px;
			color: #fff;
			cursor: pointer;
			font-weight: 700;
		}
		button:hover {
			background: #1649ad;
		}
		.actionRow {
			display: flex;
			flex-wrap: wrap;
			gap: 10px;
			margin-top: 24px;
		}
		.actionButton {
			display: inline-block;
			padding: 11px 18px;
			background: #1a57d2;
			border-radius: 4px;
			color: #fff;
			font-weight: 700;
			text-decoration: none;
		}
		.actionButton.secondary {
			background: #555;
		}
		.actionButton:hover {
			background: #1649ad;
		}
		.actionButton.secondary:hover {
			background: #444;
		}
		.notice {
			margin: 22px 0;
			padding: 14px 16px;
			border-radius: 4px;
			border-left: 5px solid #777;
			background: #f5f5f5;
		}
		.notice.ok {
			border-left-color: #ff1493;
			background: #fff0f8;
		}
		.notice.error {
			border-left-color: #c62828;
			background: #fff0f0;
		}
		.small {
			color: rgba(0,0,0,.58);
			font-size: 13px;
		}
		ul {
			margin: 8px 0 0 20px;
			padding: 0;
		}
		code {
			background: rgba(0,0,0,.06);
			padding: 2px 5px;
		}
		.successHero {
			margin: 0 0 24px 0;
			padding: 24px;
			border-radius: 4px;
			border-left: 6px solid #ff1493;
			background: linear-gradient(130deg, #fff4fb 0%, #f7f0ff 100%);
		}
		.successHero h1 {
			margin-bottom: 12px;
		}
		.successHero p {
			margin: 8px 0;
		}
		.publishedLine {
			margin-top: 20px !important;
			font-weight: 700;
		}
		.statusGrid {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 16px;
			margin: 0 0 24px 0;
		}
		.statusCard {
			border: 1px solid rgba(0,0,0,.14);
			border-radius: 4px;
			background: #fff;
			padding: 18px;
			box-shadow: 0 1px 2px rgba(0,0,0,.08);
		}
		.statusCard h2 {
			margin: 0 0 10px 0;
			color: rgba(0,0,0,.88);
			font-size: 20px;
		}
		.liveFlag {
			display: inline-block;
			margin-bottom: 10px;
			padding: 3px 8px;
			background: #8a1bbb;
			border-radius: 3px;
			color: #fff;
			font-size: 12px;
			font-weight: 700;
			letter-spacing: .04em;
		}
		.fileName {
			display: block;
			margin-top: 10px;
			word-break: break-word;
		}
		.archiveBox {
			margin: 0 0 24px 0;
			padding: 18px;
			border: 1px solid rgba(0,0,0,.14);
			border-radius: 4px;
			background: #f7f7f7;
		}
		.archiveRows {
			margin-top: 12px;
		}
		.archiveRows div {
			margin: 6px 0;
		}
		.currentLiveBox {
			margin: 22px 0;
			padding: 16px 18px;
			border: 1px solid rgba(0,0,0,.14);
			border-left: 5px solid #8a1bbb;
			border-radius: 4px;
			background: #fbf8ff;
		}
		.currentLiveBox p {
			margin: 6px 0;
		}
		.currentLiveFiles {
			margin-top: 10px;
		}
		.currentLiveFiles div {
			margin: 5px 0;
		}
		details.validationDetails {
			margin-top: 8px;
			padding: 14px 0 0 0;
		}
		details.validationDetails summary {
			cursor: pointer;
			font-weight: 700;
		}
		.checkList {
			margin-top: 12px;
			list-style: none;
		}
		.checkList li {
			margin: 5px 0;
		}
		.check {
			color: #ff1493;
			font-weight: 900;
		}
		@media (max-width: 720px) {
			#main {
				margin: 70px 12px;
				padding: 24px;
			}
			.statusGrid {
				grid-template-columns: 1fr;
			}
		}
	</style>
</head>
<body>
	<div id="topbar">
		<div id="armor-tech-logo"><a href="../../bb.html"><img id="armor-tech-logo-svg" src="../../assets/buildbooks-anchor-logo.svg" alt="Buildbooks"></a></div>
		<div id="newSiteLink">
			<a href="../../index.html" alt="Select new site">Sites >></a>
			|
			<button id="toolsMenuButton" type="button" aria-expanded="false" aria-controls="toolsMenu" title="Admin tools"><img src="../../assets/menu-icon.svg" alt="Admin tools"></button>
			<div id="toolsMenu" aria-label="Admin tools">
				<a href="../../bb.html">Buildbooks</a>
				<a href="../buildbooks-images/index.php">Restore Images</a>
			</div>
		</div>
	</div>
	<main id="main">
		<?php if ($result['ran'] && $result['ok']) { ?>
			<section class="successHero">
				<h1><span class="check">&#10003;</span> Buildbooks data is live</h1>
				<p>All uploaded files passed validation and replaced the live Buildbooks data.</p>
				<p class="publishedLine">Published: <?php echo h($result['publishedAt']); ?></p>
				<div class="actionRow">
					<a class="actionButton" href="../../bb.html?site=crn">Open Buildbooks</a>
					<a class="actionButton secondary" href="index.php">Upload another set</a>
				</div>
			</section>

			<section class="statusGrid">
				<?php foreach ($files as $key => $fileDef) { ?>
					<?php $validation = isset($result['validation'][$key]) ? $result['validation'][$key] : array('rows' => 0); ?>
					<article class="statusCard">
						<h2><?php echo h($fileDef['shortLabel']); ?></h2>
						<span class="liveFlag">LIVE</span>
						<p><?php echo h(number_format((int)$validation['rows'])); ?> rows checked</p>
						<code class="fileName"><?php echo h($fileDef['liveName']); ?></code>
					</article>
				<?php } ?>
			</section>

			<section class="archiveBox">
				<strong>Previous live files archived automatically</strong>
				<div class="archiveRows">
					<?php foreach ($files as $key => $fileDef) { ?>
						<?php if (isset($result['archives'][$key])) { ?>
							<div><?php echo h($fileDef['shortLabel']); ?> archive: <code><?php echo h($result['archives'][$key]); ?></code></div>
						<?php } ?>
					<?php } ?>
				</div>
			</section>

			<details class="validationDetails">
				<summary>Validation details</summary>
				<ul class="checkList">
					<?php foreach ($files as $key => $fileDef) { ?>
						<li><span class="check">&#10003;</span> <?php echo h($fileDef['shortLabel']); ?> passed</li>
					<?php } ?>
					<li><span class="check">&#10003;</span> Required headers found</li>
					<li><span class="check">&#10003;</span> Live files replaced</li>
				</ul>
			</details>
		<?php } else { ?>
			<h1>Upload Buildbooks Data</h1>
			<p>The current live files are archived first, then the uploaded files go live.</p>
			<p class="small">Accepted headers: <code>AssemblySKU PartSKU Quantity</code>, <code>LocalSKU ItemName Vendor UPC</code>, and the ten-column item metadata schema. Inventory may include optional trailing <code>ProductType</code> and <code>COO</code> columns; Buildbooks does not use ProductType.</p>

			<?php if ($currentLive['ok']) { ?>
				<section class="currentLiveBox">
					<strong>Current live data</strong>
					<p>Published: <?php echo h($currentLive['publishedAt']); ?></p>
					<div class="currentLiveFiles">
						<?php foreach ($files as $key => $fileDef) { ?>
							<?php if (isset($currentLive['files'][$key])) { ?>
								<div><?php echo h($fileDef['shortLabel']); ?>: <code><?php echo h($currentLive['files'][$key]['name']); ?></code></div>
							<?php } ?>
						<?php } ?>
					</div>
				</section>
			<?php } ?>

			<?php if ($result['ran']) { ?>
				<div class="notice error">
					<strong>Upload stopped. No live files were replaced.</strong>
					<ul>
						<?php foreach ($result['errors'] as $error) { ?>
							<li><?php echo h($error); ?></li>
						<?php } ?>
					</ul>
				</div>
			<?php } ?>

			<?php if ($result['ran'] && count($result['validation']) > 0) { ?>
				<div class="notice">
					<strong>Validation report</strong>
					<ul>
						<?php foreach ($result['validation'] as $validation) { ?>
							<li><?php echo h($validation['label']); ?>: <?php echo $validation['ok'] ? 'passed' : 'failed'; ?>, <?php echo h($validation['rows']); ?> data rows checked.</li>
						<?php } ?>
					</ul>
				</div>
			<?php } ?>

			<form method="post" enctype="multipart/form-data">
				<label for="bom_file">buildbooks-bom.tsv</label>
				<input id="bom_file" name="bom_file" type="file" accept=".tsv,text/tab-separated-values,text/plain" required>

				<label for="inventory_file">buildbooks-inventory.tsv</label>
				<input id="inventory_file" name="inventory_file" type="file" accept=".tsv,text/tab-separated-values,text/plain" required>

				<label for="metadata_file">buildbooks-item-metadata.tsv</label>
				<input id="metadata_file" name="metadata_file" type="file" accept=".tsv,text/tab-separated-values,text/plain" required>

				<button type="submit">Validate and Upload</button>
			</form>
		<?php } ?>
	</main>
	<script>
		(function() {
			var menuButton = document.getElementById('toolsMenuButton');
			var menu = document.getElementById('toolsMenu');
			if (!menuButton || !menu) { return; }

			menuButton.addEventListener('click', function(event) {
				event.stopPropagation();
				var isOpen = menu.classList.toggle('open');
				menuButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
			}, false);

			menu.addEventListener('click', function(event) {
				event.stopPropagation();
			}, false);

			document.addEventListener('click', function() {
				menu.classList.remove('open');
				menuButton.setAttribute('aria-expanded', 'false');
			}, false);

			document.addEventListener('keydown', function(event) {
				if (event.key === 'Escape') {
					menu.classList.remove('open');
					menuButton.setAttribute('aria-expanded', 'false');
				}
			}, false);
		})();
	</script>
</body>
</html>
