<?php

date_default_timezone_set('America/Los_Angeles');

$rootDir = realpath(__DIR__ . '/../..');
$imagesDir = $rootDir ? $rootDir . DIRECTORY_SEPARATOR . 'images' : null;
$deletedDir = $imagesDir ? $imagesDir . DIRECTORY_SEPARATOR . 'deleted-items' : null;
$buildbooksDbDir = realpath(__DIR__ . '/../buildbooks-db');
$lockPath = $buildbooksDbDir ? $buildbooksDbDir . DIRECTORY_SEPARATOR . 'image-admin.lock' : __DIR__ . DIRECTORY_SEPARATOR . 'image-admin.lock';

$imageFolders = array(
	'custom' => array('source' => 'Custom'),
	'ecom' => array('source' => 'Ecom')
);

$result = array(
	'ran' => false,
	'ok' => false,
	'messages' => array(),
	'errors' => array()
);

$requestMethod = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';
if ($requestMethod === 'POST') {
	$result['ran'] = true;
	$action = isset($_POST['action']) ? trim($_POST['action']) : 'restore';
	if ($action === 'delete') {
		$result = handleDeleteDeletedImage($deletedDir, $lockPath, $imageFolders, $result);
	} else {
		$result = handleRestore($imagesDir, $deletedDir, $lockPath, $imageFolders, $result);
	}
}

$filters = array(
	'q' => isset($_GET['q']) ? trim($_GET['q']) : ''
);

$deletedImages = listDeletedImages($deletedDir, $imageFolders, $filters);

function handleRestore($imagesDir, $deletedDir, $lockPath, $imageFolders, $result) {
	if ($imagesDir === false || $imagesDir === null || !is_dir($imagesDir)) {
		$result['errors'][] = 'Images folder was not found.';
		return $result;
	}

	if ($deletedDir === false || $deletedDir === null || !is_dir($deletedDir)) {
		$result['errors'][] = 'Deleted-items folder was not found.';
		return $result;
	}

	$folder = isset($_POST['folder']) ? trim($_POST['folder']) : '';
	if (!isset($imageFolders[$folder])) {
		$result['errors'][] = 'Invalid image folder.';
		return $result;
	}

	$filename = isset($_POST['filename']) ? trim($_POST['filename']) : '';
	if ($filename === '' || strpos($filename, '/') !== false || strpos($filename, '\\') !== false) {
		$result['errors'][] = 'Invalid image filename.';
		return $result;
	}

	$imageName = parseImageName($filename);
	if (!$imageName) {
		$result['errors'][] = 'Only Buildbooks .jpg image files can be restored.';
		return $result;
	}

	$deletedFolder = $deletedDir . DIRECTORY_SEPARATOR . $folder;
	$deletedPath = $deletedFolder . DIRECTORY_SEPARATOR . $filename;
	if (!is_file($deletedPath)) {
		$result['errors'][] = 'Deleted image was not found.';
		return $result;
	}

	$activeDir = $imagesDir . DIRECTORY_SEPARATOR . $folder;
	if (!is_dir($activeDir) && !mkdir($activeDir, 0755, true)) {
		$result['errors'][] = 'Could not create active image folder.';
		return $result;
	}

	$lock = openImageLock($lockPath);
	$stagePath = $activeDir . DIRECTORY_SEPARATOR . '.' . $imageName['skuKey'] . '.restore-' . date('Ymd-His') . '-' . mt_rand(1000, 9999) . '.tmp';

	if (!rename($deletedPath, $stagePath)) {
		closeImageLock($lock);
		$result['errors'][] = 'Could not stage image for restore.';
		return $result;
	}

	$count = countSequentialImages($activeDir, $imageName['skuKey']);
	$targetIndex = $imageName['index'] <= $count ? $imageName['index'] : $count;
	$shift = shiftStackUp($activeDir, $imageName['skuKey'], $targetIndex, $count);

	if (!$shift['ok']) {
		rollbackMovedImages($shift['moved']);
		@rename($stagePath, $deletedPath);
		closeImageLock($lock);
		$result['errors'][] = 'Could not make room in the active image stack.';
		return $result;
	}

	$targetPath = imagePath($activeDir, $imageName['skuKey'], $targetIndex);
	if (!rename($stagePath, $targetPath)) {
		rollbackMovedImages($shift['moved']);
		@rename($stagePath, $deletedPath);
		closeImageLock($lock);
		$result['errors'][] = 'Could not restore image to the active folder.';
		return $result;
	}

	bumpImageVersion($imagesDir);
	closeImageLock($lock);
	cleanupEmptyFolder($deletedFolder);

	$result['ok'] = true;
	$result['messages'][] = 'Restored ' . $filename . ' to ' . $folder . ' as ' . basename($targetPath) . '.';
	return $result;
}

function handleDeleteDeletedImage($deletedDir, $lockPath, $imageFolders, $result) {
	if ($deletedDir === false || $deletedDir === null || !is_dir($deletedDir)) {
		$result['errors'][] = 'Deleted-items folder was not found.';
		return $result;
	}

	$folder = isset($_POST['folder']) ? trim($_POST['folder']) : '';
	if (!isset($imageFolders[$folder])) {
		$result['errors'][] = 'Invalid image folder.';
		return $result;
	}

	$filename = isset($_POST['filename']) ? trim($_POST['filename']) : '';
	if ($filename === '' || strpos($filename, '/') !== false || strpos($filename, '\\') !== false) {
		$result['errors'][] = 'Invalid image filename.';
		return $result;
	}

	if (!parseImageName($filename)) {
		$result['errors'][] = 'Only Buildbooks .jpg image files can be deleted.';
		return $result;
	}

	$deletedFolder = $deletedDir . DIRECTORY_SEPARATOR . $folder;
	$deletedPath = $deletedFolder . DIRECTORY_SEPARATOR . $filename;
	if (!is_file($deletedPath)) {
		$result['errors'][] = 'Deleted image was not found.';
		return $result;
	}

	$lock = openImageLock($lockPath);
	if (!unlink($deletedPath)) {
		closeImageLock($lock);
		$result['errors'][] = 'Could not delete image.';
		return $result;
	}
	closeImageLock($lock);
	cleanupEmptyFolder($deletedFolder);

	$result['ok'] = true;
	$result['messages'][] = 'Deleted ' . $filename . ' from Restore Images.';
	return $result;
}

function listDeletedImages($deletedDir, $imageFolders, $filters) {
	$items = array();

	if ($deletedDir === false || $deletedDir === null || !is_dir($deletedDir)) {
		return $items;
	}

	foreach ($imageFolders as $folder => $labels) {
		$folderPath = $deletedDir . DIRECTORY_SEPARATOR . $folder;
		if (!is_dir($folderPath)) {
			continue;
		}

		$files = scandir($folderPath);
		if ($files === false) {
			continue;
		}

		foreach ($files as $file) {
			if ($file === '.' || $file === '..') {
				continue;
			}

			$path = $folderPath . DIRECTORY_SEPARATOR . $file;
			if (!is_file($path)) {
				continue;
			}

			$imageName = parseImageName($file);
			if (!$imageName) {
				continue;
			}

			$sku = rawurldecode($imageName['skuKey']);
			$haystack = strtolower($file . ' ' . $sku . ' ' . $folder . ' ' . $labels['source']);
			if ($filters['q'] !== '' && strpos($haystack, strtolower($filters['q'])) === false) {
				continue;
			}

			$items[] = array(
				'folder' => $folder,
				'source' => $labels['source'],
				'filename' => $file,
				'activeFilename' => $imageName['activeName'],
				'sku' => $sku,
				'index' => $imageName['index'],
				'modified' => filemtime($path),
				'size' => filesize($path),
				'url' => '../../images/deleted-items/' . rawurlencode($folder) . '/' . rawurlencode($file)
			);
		}
	}

	usort($items, 'sortImagesNewestFirst');
	return $items;
}

function sortImagesNewestFirst($a, $b) {
	if ($a['modified'] === $b['modified']) {
		return strcmp($a['filename'], $b['filename']);
	}
	return $a['modified'] < $b['modified'] ? 1 : -1;
}

function parseImageName($filename) {
	$activeName = $filename;
	if (preg_match('/^(.+)__deleted-[0-9]{8}-[0-9]{6}(?:_[0-9]+)?\.jpg$/i', $filename, $deletedMatches)) {
		$activeName = $deletedMatches[1] . '.jpg';
	}

	if (!preg_match('/^(.+?)(?:_([0-9]+))?\.jpg$/i', $activeName, $matches)) {
		return false;
	}

	return array(
		'skuKey' => $matches[1],
		'index' => isset($matches[2]) && $matches[2] !== '' ? (int)$matches[2] : 0,
		'activeName' => $activeName
	);
}

function shiftStackUp($dir, $skuKey, $startIndex, $count) {
	$moved = array();
	for ($i = $count - 1; $i >= $startIndex; $i--) {
		$from = imagePath($dir, $skuKey, $i);
		$to = imagePath($dir, $skuKey, $i + 1);
		if (!rename($from, $to)) {
			return array('ok' => false, 'moved' => $moved);
		}
		$moved[] = array('from' => $from, 'to' => $to);
	}

	return array('ok' => true, 'moved' => $moved);
}

function rollbackMovedImages($moved) {
	for ($i = count($moved) - 1; $i >= 0; $i--) {
		$from = $moved[$i]['from'];
		$to = $moved[$i]['to'];
		if (is_file($to) && !is_file($from)) {
			@rename($to, $from);
		}
	}
}

function countSequentialImages($dir, $skuKey) {
	$count = 0;
	while (is_file(imagePath($dir, $skuKey, $count))) {
		$count++;
	}
	return $count;
}

function imagePath($dir, $skuKey, $index) {
	return $dir . DIRECTORY_SEPARATOR . imageName($skuKey, $index);
}

function imageName($skuKey, $index) {
	return $index === 0 ? $skuKey . '.jpg' : $skuKey . '_' . $index . '.jpg';
}

function bumpImageVersion($imagesDir) {
	if ($imagesDir === false || $imagesDir === null || !is_dir($imagesDir)) {
		return '';
	}

	$version = date('YmdHis') . '-' . substr(str_replace(' ', '', microtime()), 2, 6);
	$path = $imagesDir . DIRECTORY_SEPARATOR . 'image-version.txt';
	if (file_put_contents($path, $version . "\n", LOCK_EX) === false) {
		return '';
	}

	return $version;
}

function openImageLock($lockPath) {
	$lock = fopen($lockPath, 'c');
	if (!$lock || !flock($lock, LOCK_EX)) {
		sendErrorAndExit('Could not lock image operation.');
	}
	return $lock;
}

function closeImageLock($lock) {
	if ($lock) {
		flock($lock, LOCK_UN);
		fclose($lock);
	}
}

function cleanupEmptyFolder($folder) {
	if (!is_dir($folder)) {
		return;
	}

	$files = scandir($folder);
	if ($files !== false && count($files) === 2) {
		@rmdir($folder);
	}
}

function formatFileTime($timestamp) {
	if (!$timestamp) {
		return '';
	}
	return date('F j, Y g:i A', $timestamp);
}

function formatFileSize($bytes) {
	$bytes = (int)$bytes;
	if ($bytes >= 1048576) {
		return round($bytes / 1048576, 1) . ' MB';
	}
	if ($bytes >= 1024) {
		return round($bytes / 1024, 1) . ' KB';
	}
	return $bytes . ' bytes';
}

function sendErrorAndExit($message) {
	http_response_code(500);
	echo $message;
	exit;
}

function h($value) {
	return htmlspecialchars((string)$value, ENT_QUOTES, 'UTF-8');
}

?>
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Buildbooks Image Restore</title>
	<link rel="icon" type="image/png" sizes="32x32" href="../../assets/favicon-32x32.png">
	<link rel="icon" type="image/png" sizes="16x16" href="../../assets/favicon-16x16.png">
	<link rel="shortcut icon" href="../../favicon.ico">
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
		#topbarActions {
			position: absolute;
			top: 10px;
			right: 10px;
			background: rgba(8, 18, 52, 0.55);
			border-left: 1px solid rgba(255, 255, 255, 0.16);
			padding: 2px 12px;
			border-radius: 3px;
			color: rgb(205 137 182 / 50%);
		}
		#topbarActions a {
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
			max-width: 1120px;
			margin: 70px auto;
			background: #fff url("../../assets/60-lines.png");
			border-radius: 4px;
			box-shadow: 0 0 0 1px rgba(0,0,0,.1), 0 2px 3px rgba(0,0,0,.2);
			padding: 32px;
		}
		h1 {
			margin: 0 0 8px 0;
			color: rgba(0,0,0,.9);
			font-size: 34px;
		}
		p {
			line-height: 1.45;
		}
		button,
		input,
		select {
			font-family: 'Miriam Libre', Arial, Helvetica, sans-serif;
		}
		button {
			padding: 9px 14px;
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
		.notice {
			margin: 20px 0;
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
		.filterBar {
			display: flex;
			flex-wrap: nowrap;
			gap: 10px;
			align-items: center;
			margin: 24px 0;
			padding: 16px;
			border: 1px solid rgba(0,0,0,.14);
			border-radius: 4px;
			background: #f7f7f7;
		}
		.filterBar input {
			box-sizing: border-box;
			height: 34px;
			border: 1px solid #bbb;
			border-radius: 3px;
			padding: 6px 8px;
			background: #fff;
			flex: 1;
			min-width: 260px;
		}
		.imageGrid {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
			gap: 18px;
		}
		.imageCard {
			border: 1px solid rgba(0,0,0,.14);
			border-radius: 4px;
			background: #fff;
			box-shadow: 0 1px 2px rgba(0,0,0,.08);
			overflow: hidden;
		}
		.imagePreview {
			display: block;
			width: 100%;
			aspect-ratio: 4 / 3;
			object-fit: contain;
			background: #f1f1f1 url("../../assets/60-lines.png");
		}
		.imageBody {
			padding: 14px;
		}
		.metaLine {
			margin: 5px 0;
			font-size: 13px;
			line-height: 1.35;
			word-break: break-word;
		}
		.metaLine strong {
			color: rgba(0,0,0,.88);
		}
		.badges {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
			margin-bottom: 10px;
		}
		.badge {
			display: inline-block;
			padding: 3px 7px;
			border-radius: 3px;
			background: #8a1bbb;
			color: #fff;
			font-size: 12px;
			font-weight: 700;
		}
		.badge.secondary {
			background: #555;
		}
		.imageCardActions {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			margin-top: 12px;
		}
		.imageCardActions form {
			margin: 0;
		}
		.imageCardActions .deleteButton {
			background: #f7f7f7;
			border-color: #777;
			color: #333;
		}
		.emptyState {
			padding: 28px;
			border: 1px dashed rgba(0,0,0,.28);
			border-radius: 4px;
			background: #fafafa;
			text-align: center;
		}
		.small {
			color: rgba(0,0,0,.58);
			font-size: 13px;
		}
		@media (max-width: 720px) {
			#main {
				margin: 70px 12px;
				padding: 24px;
			}
			.filterBar input {
				width: 100%;
				min-width: 0;
			}
			.filterBar {
				flex-wrap: wrap;
			}
		}
	</style>
</head>
<body>
	<div id="topbar">
		<div id="armor-tech-logo"><a href="../../bb.html?item=QAR-0001&amp;tab=1"><img id="armor-tech-logo-svg" src="../../assets/buildbooks-anchor-logo.svg" alt="Buildbooks"></a></div>
		<div id="topbarActions">
			<button id="toolsMenuButton" type="button" aria-expanded="false" aria-controls="toolsMenu" title="Admin tools"><img src="../../assets/menu-icon.svg" alt="Admin tools"></button>
			<div id="toolsMenu" aria-label="Admin tools">
				<a href="/">Return to Bob's App</a>
				<a href="../../bb.html?item=QAR-0001&amp;tab=1">Buildbooks</a>
				<a href="../buildbooks-db/index.php">Upload Database</a>
			</div>
		</div>
	</div>
	<main id="main">
		<h1>Buildbooks Image Restore</h1>
		<p>Restore images that were moved to deleted-items by the Buildbooks image controls.</p>

		<?php if ($result['ran'] && $result['ok']) { ?>
			<div class="notice ok">
				<?php foreach ($result['messages'] as $message) { ?>
					<div><?php echo h($message); ?></div>
				<?php } ?>
			</div>
		<?php } else if ($result['ran']) { ?>
			<div class="notice error">
				<?php foreach ($result['errors'] as $error) { ?>
					<div><?php echo h($error); ?></div>
				<?php } ?>
			</div>
		<?php } ?>

		<form class="filterBar" method="get" action="index.php">
			<input id="q" name="q" type="search" value="<?php echo h($filters['q']); ?>" placeholder="SKU or filename">
			<button type="submit">Search</button>
		</form>

		<?php if (count($deletedImages) < 1) { ?>
			<section class="emptyState">
				<h2>No deleted images found</h2>
				<p class="small">Deleted images will appear here after an image is removed from Buildbooks.</p>
			</section>
		<?php } else { ?>
			<section class="imageGrid">
				<?php foreach ($deletedImages as $item) { ?>
					<article class="imageCard">
						<img class="imagePreview" src="<?php echo h($item['url']); ?>" alt="<?php echo h($item['filename']); ?>">
						<div class="imageBody">
							<div class="badges">
								<span class="badge"><?php echo h($item['source']); ?></span>
							</div>
							<div class="metaLine"><strong>SKU:</strong> <?php echo h($item['sku']); ?></div>
							<div class="metaLine"><strong>Active file:</strong> <?php echo h($item['activeFilename']); ?></div>
							<?php if ($item['filename'] !== $item['activeFilename']) { ?>
								<div class="metaLine"><strong>Deleted copy:</strong> <?php echo h($item['filename']); ?></div>
							<?php } ?>
							<div class="metaLine"><strong>Modified:</strong> <?php echo h(formatFileTime($item['modified'])); ?></div>
							<div class="metaLine"><strong>Size:</strong> <?php echo h(formatFileSize($item['size'])); ?></div>
							<div class="imageCardActions">
								<form method="post" action="index.php<?php echo $filters['q'] !== '' ? '?' . h(http_build_query($filters)) : ''; ?>" onsubmit="return confirm('Restore this image to Buildbooks?');">
									<input type="hidden" name="action" value="restore">
									<input type="hidden" name="folder" value="<?php echo h($item['folder']); ?>">
									<input type="hidden" name="filename" value="<?php echo h($item['filename']); ?>">
									<button type="submit">Restore Image</button>
								</form>
								<form method="post" action="index.php<?php echo $filters['q'] !== '' ? '?' . h(http_build_query($filters)) : ''; ?>" onsubmit="return confirm('Delete this image from Restore Images?');">
									<input type="hidden" name="action" value="delete">
									<input type="hidden" name="folder" value="<?php echo h($item['folder']); ?>">
									<input type="hidden" name="filename" value="<?php echo h($item['filename']); ?>">
									<button class="deleteButton" type="submit">Delete Altogether</button>
								</form>
							</div>
						</div>
					</article>
				<?php } ?>
			</section>
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
