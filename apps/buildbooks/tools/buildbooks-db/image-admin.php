<?php

date_default_timezone_set('America/Los_Angeles');

header('Content-Type: application/json');

$rootDir = realpath(__DIR__ . '/../..');
$imagesDir = $rootDir ? $rootDir . DIRECTORY_SEPARATOR . 'images' : null;
$lockPath = __DIR__ . DIRECTORY_SEPARATOR . 'image-admin.lock';

$requestMethod = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';
if ($requestMethod !== 'POST') {
	sendJson(false, 'POST is required.', 405);
}

$action = isset($_POST['action']) ? $_POST['action'] : '';

if ($action === 'upload') {
	handleUploadImage($imagesDir, $lockPath);
} else if ($action === 'delete') {
	handleDeleteImage($imagesDir, $lockPath);
} else {
	sendJson(false, 'Unknown image action.', 400);
}

function handleUploadImage($imagesDir, $lockPath) {
	$skuKey = getSkuKey();
	$targetDir = ensureImageDir($imagesDir, 'custom');
	$firstPath = imagePath($targetDir, $skuKey, 0);

	if (!isset($_FILES['image']) || !is_array($_FILES['image'])) {
		sendJson(false, 'Image upload is required.', 400);
	}

	$file = $_FILES['image'];
	if (!isset($file['error']) || is_array($file['error'])) {
		sendJson(false, 'Image upload was not readable.', 400);
	}

	if ($file['error'] !== UPLOAD_ERR_OK) {
		sendJson(false, uploadErrorMessage($file['error']), 400);
	}

	if (!isset($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
		sendJson(false, 'Upload was not accepted by PHP.', 400);
	}

	if (!isset($file['size']) || (int)$file['size'] <= 0) {
		sendJson(false, 'Uploaded image is empty.', 400);
	}

	$imageInfo = @getimagesize($file['tmp_name']);
	if ($imageInfo === false || !isset($imageInfo['mime']) || !isset($imageInfo[0]) || !isset($imageInfo[1])) {
		sendJson(false, 'Uploaded file is not a readable image.', 400);
	}
	if ($imageInfo['mime'] !== 'image/jpeg' && $imageInfo['mime'] !== 'image/png') {
		sendJson(false, 'Only JPEG and PNG images are accepted.', 400);
	}

	$stagePath = $targetDir . DIRECTORY_SEPARATOR . '.' . $skuKey . '.upload-' . date('Ymd-His') . '-' . mt_rand(1000, 9999) . '.tmp';

	$lock = openImageLock($lockPath);
	$staged = stageUploadedImage($file['tmp_name'], $stagePath, $imageInfo);
	if (!$staged['ok']) {
		closeImageLock($lock);
		sendJson(false, $staged['message'], 500);
	}

	$count = countSequentialImages($targetDir, $skuKey);
	for ($i = $count - 1; $i >= 0; $i--) {
		$from = imagePath($targetDir, $skuKey, $i);
		$to = imagePath($targetDir, $skuKey, $i + 1);
		if (!rename($from, $to)) {
			@unlink($stagePath);
			closeImageLock($lock);
			sendJson(false, 'Could not shift existing images.', 500);
		}
	}

	if (!rename($stagePath, $firstPath)) {
		for ($i = 1; $i <= $count; $i++) {
			$from = imagePath($targetDir, $skuKey, $i);
			$to = imagePath($targetDir, $skuKey, $i - 1);
			if (is_file($from) && !is_file($to)) {
				@rename($from, $to);
			}
		}
		@unlink($stagePath);
		closeImageLock($lock);
		sendJson(false, 'Could not install uploaded image.', 500);
	}

	$imageVersion = bumpImageVersion($imagesDir);
	closeImageLock($lock);
	sendJson(true, 'Image uploaded.', 200, array(
		'filename' => basename($firstPath),
		'imageVersion' => $imageVersion
	));
}

function handleDeleteImage($imagesDir, $lockPath) {
	$source = getValidSource();
	$skuKey = getSkuKey();
	$index = getValidIndex();
	$expectedName = imageName($skuKey, $index);
	$postedName = isset($_POST['filename']) ? basename($_POST['filename']) : '';

	if ($postedName !== '' && $postedName !== $expectedName) {
		sendJson(false, 'Selected image does not match the expected filename.', 400);
	}

	$sourceDir = imageDir($imagesDir, $source);
	$targetPath = imagePath($sourceDir, $skuKey, $index);
	if (!is_file($targetPath)) {
		sendJson(false, 'Selected image was not found.', 404);
	}

	$deletedDir = $imagesDir . DIRECTORY_SEPARATOR . 'deleted-items' . DIRECTORY_SEPARATOR . $source;
	if (!is_dir($deletedDir) && !mkdir($deletedDir, 0755, true)) {
		sendJson(false, 'Could not create deleted-items folder.', 500);
	}

	$lock = openImageLock($lockPath);
	$deletedPath = nextDeletedImagePath($deletedDir, $expectedName);

	if (!rename($targetPath, $deletedPath)) {
		closeImageLock($lock);
		sendJson(false, 'Could not move selected image to deleted-items.', 500);
	}

	if (!closeImageGap($sourceDir, $skuKey, $index)) {
		closeImageLock($lock);
		sendJson(false, 'Image was moved, but remaining images could not be renumbered.', 500);
	}

	$imageVersion = bumpImageVersion($imagesDir);
	closeImageLock($lock);
	sendJson(true, 'Image deleted from Buildbooks.', 200, array(
		'deletedFilename' => basename($deletedPath),
		'imageVersion' => $imageVersion
	));
}

function stageUploadedImage($tmpPath, $stagePath, $imageInfo) {
	$width = (int)$imageInfo[0];
	$height = (int)$imageInfo[1];
	$longEdge = max($width, $height);
	$maxEdge = 2500;
	$mime = $imageInfo['mime'];

	if ($mime === 'image/jpeg' && $longEdge <= $maxEdge) {
		return array(
			'ok' => move_uploaded_file($tmpPath, $stagePath),
			'message' => 'Could not stage uploaded image.'
		);
	}

	if (!function_exists('imagecreatetruecolor') || !function_exists('imagecopyresampled') || !function_exists('imagejpeg')) {
		return array('ok' => false, 'message' => 'ImageGD is required to process this image.');
	}

	if ($mime === 'image/jpeg') {
		if (!function_exists('imagecreatefromjpeg')) {
			return array('ok' => false, 'message' => 'ImageGD JPEG support is not available.');
		}
		$source = @imagecreatefromjpeg($tmpPath);
	} else {
		if (!function_exists('imagecreatefrompng')) {
			return array('ok' => false, 'message' => 'ImageGD PNG support is not available.');
		}
		$source = @imagecreatefrompng($tmpPath);
	}

	if (!$source) {
		return array('ok' => false, 'message' => 'Uploaded image could not be decoded.');
	}

	$scale = $longEdge > $maxEdge ? $maxEdge / $longEdge : 1;
	$newWidth = max(1, (int)round($width * $scale));
	$newHeight = max(1, (int)round($height * $scale));
	$target = imagecreatetruecolor($newWidth, $newHeight);

	if (!$target) {
		imagedestroy($source);
		return array('ok' => false, 'message' => 'Could not prepare uploaded image.');
	}

	imagefill($target, 0, 0, imagecolorallocate($target, 255, 255, 255));
	$copied = imagecopyresampled($target, $source, 0, 0, 0, 0, $newWidth, $newHeight, $width, $height);
	$written = $copied ? imagejpeg($target, $stagePath, 88) : false;

	imagedestroy($source);
	imagedestroy($target);

	return array(
		'ok' => $written,
		'message' => 'Could not stage uploaded image.'
	);
}

function closeImageGap($sourceDir, $skuKey, $startIndex) {
	$index = $startIndex + 1;
	while (is_file(imagePath($sourceDir, $skuKey, $index))) {
		$from = imagePath($sourceDir, $skuKey, $index);
		$to = imagePath($sourceDir, $skuKey, $index - 1);
		if (!rename($from, $to)) {
			return false;
		}
		$index++;
	}
	return true;
}

function openImageLock($lockPath) {
	$lock = fopen($lockPath, 'c');
	if (!$lock || !flock($lock, LOCK_EX)) {
		sendJson(false, 'Could not lock image operation.', 500);
	}
	return $lock;
}

function closeImageLock($lock) {
	if ($lock) {
		flock($lock, LOCK_UN);
		fclose($lock);
	}
}

function getValidSource() {
	$source = isset($_POST['source']) ? strtolower(trim($_POST['source'])) : '';
	if ($source !== 'custom' && $source !== 'ecom') {
		sendJson(false, 'Invalid image source.', 400);
	}
	return $source;
}

function getSkuKey() {
	$sku = isset($_POST['sku']) ? trim($_POST['sku']) : '';
	if ($sku === '') {
		sendJson(false, 'SKU is required.', 400);
	}
	return strtolower(rawurlencode($sku));
}

function getValidIndex() {
	$index = isset($_POST['index']) ? trim($_POST['index']) : '';
	if ($index === '' || !ctype_digit($index) || (int)$index > 999) {
		sendJson(false, 'Invalid image index.', 400);
	}
	return (int)$index;
}

function ensureImageDir($imagesDir, $source) {
	$dir = imageDir($imagesDir, $source);
	if (!is_dir($dir) && !mkdir($dir, 0755, true)) {
		sendJson(false, 'Could not create image folder.', 500);
	}
	return $dir;
}

function imageDir($imagesDir, $source) {
	if ($imagesDir === false || $imagesDir === null || !is_dir($imagesDir)) {
		sendJson(false, 'Images folder was not found.', 500);
	}
	return $imagesDir . DIRECTORY_SEPARATOR . $source;
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

function nextDeletedImagePath($deletedDir, $originalName) {
	$base = preg_replace('/\.jpg$/i', '', $originalName);
	$stamp = date('Ymd-His');
	$name = $base . '__deleted-' . $stamp . '.jpg';
	$path = $deletedDir . DIRECTORY_SEPARATOR . $name;
	$suffix = 2;

	while (is_file($path)) {
		$name = $base . '__deleted-' . $stamp . '_' . $suffix . '.jpg';
		$path = $deletedDir . DIRECTORY_SEPARATOR . $name;
		$suffix++;
	}

	return $path;
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

function uploadErrorMessage($code) {
	$messages = array(
		UPLOAD_ERR_INI_SIZE => 'Image exceeds the server upload limit.',
		UPLOAD_ERR_FORM_SIZE => 'Image exceeds the form upload limit.',
		UPLOAD_ERR_PARTIAL => 'Image was only partially uploaded.',
		UPLOAD_ERR_NO_FILE => 'No image was uploaded.',
		UPLOAD_ERR_NO_TMP_DIR => 'Server temporary folder is missing.',
		UPLOAD_ERR_CANT_WRITE => 'Server could not write the uploaded image.',
		UPLOAD_ERR_EXTENSION => 'A PHP extension stopped the upload.'
	);

	return isset($messages[$code]) ? $messages[$code] : 'Unknown upload error.';
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
