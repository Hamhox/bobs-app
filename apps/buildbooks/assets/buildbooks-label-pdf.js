/* global JsBarcode, PDFLib, fontkit */
(function (global) {
	'use strict';

	var PAGE_WIDTH = 252;
	var PAGE_HEIGHT = 72;
	var PX_TO_PT = 0.75;
	var currentScriptUrl = document.currentScript ? document.currentScript.src : global.location.href;
	var assetBaseUrl = new URL('.', currentScriptUrl);
	var logoBytesPromise = null;
	var fontBytesPromise = null;

	var ICON_PATHS = {
		fragile: {
			viewBox: 24,
			paths: [
				'M6.881,3.203L6.879,7.255c0.051,1.106,0.277,2.148,0.779,3.118c0.789,1.502,2.159,2.568,3.841,2.83l-0.008,6.452l-2.757,0.378c-0.362,0.072-0.559,0.431-0.455,0.764l7.425,0.001c0.125-0.338-0.077-0.717-0.485-0.772l-2.716-0.369l0.004-6.461c1.815-0.259,3.262-1.529,4.002-3.163c0.374-0.886,0.597-1.798,0.599-2.778l0.01-4.049L6.881,3.203zM7.954,6.785l-0.009-2.61l1.019-0.003l0.013,3.372c0.003,0.697,0.099,1.337,0.256,2.068C8.422,9.037,7.957,7.796,7.954,6.785z'
			]
		},
		storeDry: {
			viewBox: 24,
			paths: [
				'M9.36,18.513c-0.072,0.688,0.33,1.236,0.97,1.306c0.585,0.064,1.208-0.353,1.209-1.026l0.013-7.297c-1.103-0.973-2.854-0.873-3.8,0.298c-0.999-1.257-2.957-1.26-3.981-0.12c-0.036,0.05-0.094,0.073-0.131,0.07c-0.033-0.002-0.101-0.053-0.092-0.121c0.54-3.948,4.008-6.897,7.974-7.201l0.02-0.749c0.007-0.268,0.201-0.451,0.427-0.478c0.236-0.028,0.531,0.086,0.538,0.358l0.022,0.876c3.983,0.278,7.35,3.136,7.919,7.139c0.011,0.079-0.007,0.138-0.054,0.162c-0.05,0.025-0.136,0.014-0.182-0.059c-1.023-1.15-2.95-1.119-3.972,0.114c-0.942-1.132-2.581-1.251-3.716-0.369l-0.019,7.414c-0.003,1.208-1.084,2.051-2.197,1.974c-1.182-0.082-2.014-1.068-1.948-2.267c0.018-0.324,0.146-0.567,0.479-0.584C9.112,17.939,9.399,18.145,9.36,18.513z'
			]
		},
		keepAwayFromFlame: {
			viewBox: 17.43,
			paths: [
				'M8.71,0C3.9,0,0,3.9,0,8.71s3.9,8.71,8.71,8.71s8.71-3.9,8.71-8.71S13.53,0,8.71,0zM3.89,14.31C0.96,11.69,0.54,7.11,3.06,3.97l6.8,6.8l3.61,3.62c-2.78,2.44-6.85,2.36-9.57-0.08zM14.38,13.43L3.98,3.03C7.31,0.17,12.35,0.86,14.78,4.53c1.77,2.68,1.69,6.29-0.39,8.9z',
				'M6.06,7.61c-0.28,0.53-0.33,1.07-0.38,1.63c-0.47-0.49-0.54-1.1-0.46-1.75c-1.58,1.42-1.55,4.11-0.2,5.69c0.66,0.76,1.47,1.28,2.45,1.47c-1.12-0.92-1.58-2.26-0.86-3.54c0.25,0.32,0.43,0.55,0.73,0.71c-0.2-0.89-0.02-1.73,0.48-2.47L6.06,7.61z',
				'M9.42,14.72c0.99-0.16,1.77-0.67,2.39-1.38l-2.06-2.02c0.62,1.18,0.52,2.43-0.34,3.4z',
				'M10.72,7.42c0.08-1.38-0.4-2.61-1.25-3.63c-0.43-0.49-0.91-0.91-1.53-1.15c0.23,1.11-0.02,2.16-0.62,3.09l4.16,4.19l1.49,1.45c0.56-1.94-0.17-4.13-1.47-5.62c-0.04,0.69-0.2,1.32-0.78,1.66z'
			]
		},
		toxic: {
			viewBox: 24,
			paths: [
				'M18.671,19.914c0.132,0.501-0.129,0.992-0.609,1.117c-0.482,0.125-0.993-0.178-1.092-0.704c-0.052-0.275-0.178-0.459-0.449-0.571l-4.29-1.775c-0.175-0.072-0.326-0.062-0.497,0.009l-4.281,1.783c-0.23,0.096-0.348,0.283-0.382,0.517c-0.077,0.525-0.559,0.862-1.055,0.747c-0.476-0.111-0.803-0.598-0.658-1.101c0.044-0.153-0.056-0.237-0.185-0.278c-0.474-0.151-0.765-0.647-0.556-1.114c0.236-0.529,0.896-0.665,1.357-0.337c0.239,0.17,0.475,0.181,0.739,0.07l2.706-1.14L5.626,15.08c-0.268-0.145-0.541,0.017-0.756,0.163c-0.434,0.293-0.989,0.145-1.235-0.274c-0.263-0.448-0.052-1.013,0.453-1.205c0.137-0.052,0.206-0.16,0.153-0.304c-0.193-0.52,0.065-1.037,0.597-1.157c0.49-0.11,1.013,0.242,1.044,0.79c0.018,0.328,0.177,0.487,0.43,0.653l4.053,2.665c1.058,0.696,2.173,0.705,3.237,0.008l4.202-2.751c0.218-0.143,0.322-0.347,0.345-0.605c0.045-0.507,0.51-0.844,0.977-0.769c0.526,0.085,0.803,0.576,0.653,1.11c-0.02,0.07-0.035,0.164-0.01,0.232c0.018,0.047,0.087,0.092,0.156,0.123c0.502,0.226,0.698,0.747,0.443,1.203c-0.24,0.429-0.838,0.579-1.256,0.264c-0.261-0.197-0.536-0.254-0.842-0.089l-3.679,1.988l2.887,1.213c0.393,0.165,0.721-0.472,1.403-0.268c0.203,0.06,0.481,0.259,0.559,0.538c0.133,0.48-0.127,0.935-0.602,1.042C18.709,19.68,18.639,19.793,18.671,19.914z',
				'M16.802,10.769c1.269-2.735,0.477-5.947-2.277-7.26c-1.66-0.791-3.66-0.755-5.285,0.103c-2.608,1.377-3.317,4.467-2.097,7.113c0.102,0.221,0.116,0.387,0.02,0.62c-0.186,0.448-0.121,0.935,0.179,1.32c0.25,0.322,0.689,0.492,1.15,0.458c0.606-0.045,1.015,0.371,1.027,0.977c0.007,0.316-0.028,0.693,0.121,0.977c0.159,0.304,0.523,0.444,0.829,0.549l0.04-0.656c0.183-0.043,0.4-0.019,0.571,0.074l0.016,0.752c0.184,0.066,0.379,0.089,0.558,0.03c0.017-0.239-0.067-0.517,0.052-0.713c0.083-0.132,0.531-0.133,0.598,0.006l0.036,0.735c0.171,0.019,0.356,0.005,0.521-0.063l0.056-0.712c0.069-0.149,0.392-0.141,0.529-0.098L13.49,15.6c0.366-0.104,0.722-0.263,0.865-0.6c0.185-0.439-0.08-1.216,0.351-1.634c0.491-0.476,1.364,0.041,1.925-0.74C17.229,11.792,16.554,11.303,16.802,10.769zM10.584,11.191c-0.48,0.374-1.076,0.496-1.638,0.39c-0.873-0.165-1.036-1.602-0.485-2.179c0.378-0.396,0.93-0.413,1.452-0.393c0.596,0.023,1.143,0.344,1.212,0.972C11.173,10.427,10.957,10.9,10.584,11.191zM12.682,13.232c-0.356,0.192-0.499-0.319-0.676-0.327c-0.182-0.009-0.325,0.477-0.638,0.352c-0.546-0.217,0.014-1.267,0.384-1.925c0.087-0.155,0.367-0.164,0.456-0.005C12.547,11.931,13.105,13.003,12.682,13.232zM15.486,11.315c-0.509,0.574-2.117,0.352-2.556-0.704c-0.139-0.335-0.163-0.674,0.007-1c0.318-0.61,1.231-0.704,1.947-0.548c0.504,0.11,0.86,0.514,0.915,1.03C15.844,10.513,15.787,10.975,15.486,11.315z'
			]
		}
	};

	function requireDependency(name, value) {
		if (!value) {
			throw new Error(name + ' is not available.');
		}
		return value;
	}

	function truncateText(text, font, size, maxWidth) {
		var value = String(text || '');
		if (font.widthOfTextAtSize(value, size) <= maxWidth) { return value; }
		var suffix = '...';
		while (value.length > 0 && font.widthOfTextAtSize(value + suffix, size) > maxWidth) {
			value = value.slice(0, -1);
		}
		return value + suffix;
	}

	function fitTextSize(text, font, preferredSize, minimumSize, maxWidth) {
		var size = preferredSize;
		while (size > minimumSize && font.widthOfTextAtSize(text, size) > maxWidth) {
			size -= 0.1;
		}
		return Math.max(size, minimumSize);
	}

	function drawTextFromTop(page, text, options) {
		var value = truncateText(text, options.font, options.size, options.maxWidth || PAGE_WIDTH);
		var textHeight = options.font.heightAtSize(options.size, { descender: false });
		page.drawText(value, {
			x: options.x,
			y: PAGE_HEIGHT - options.top - textHeight,
			size: options.size,
			font: options.font,
			color: options.color
		});
		return value;
	}

	function encodeBarcode(value, options) {
		var target = {};
		requireDependency('JsBarcode', global.JsBarcode)(target, value, options);
		if (!target.encodings || target.encodings.length === 0) {
			throw new Error('Unable to encode barcode value: ' + value);
		}
		return target.encodings;
	}

	function barcodeWidth(encodings, scale) {
		var firstOptions = encodings[0].options;
		var modules = encodings.reduce(function (total, encoding) {
			return total + encoding.data.length;
		}, 0);
		return (firstOptions.marginLeft + firstOptions.marginRight) * scale + modules * firstOptions.width * scale;
	}

	function drawBarcode(page, encodings, options) {
		var firstOptions = encodings[0].options;
		var scale = options.scale || 1;
		var cursorX = options.x + firstOptions.marginLeft * scale;

		encodings.forEach(function (encoding) {
			var barcodeOptions = encoding.options;
			var moduleWidth = barcodeOptions.width * scale;
			var barHeight = barcodeOptions.height * scale;
			var barTop = options.top + barcodeOptions.marginTop * scale;
			var runStart = -1;

			for (var index = 0; index <= encoding.data.length; index++) {
				var isBar = encoding.data.charAt(index) === '1';
				if (isBar && runStart < 0) {
					runStart = index;
				}
				if (!isBar && runStart >= 0) {
					page.drawRectangle({
						x: cursorX + runStart * moduleWidth,
						y: PAGE_HEIGHT - barTop - barHeight,
						width: (index - runStart) * moduleWidth,
						height: barHeight,
						color: options.color
					});
					runStart = -1;
				}
			}

			var segmentWidth = encoding.data.length * moduleWidth;
			if (options.font && barcodeOptions.displayValue && encoding.text) {
				var fontSize = barcodeOptions.fontSize * scale;
				var textWidth = options.font.widthOfTextAtSize(encoding.text, fontSize);
				var textX = cursorX + (segmentWidth - textWidth) / 2;
				if (barcodeOptions.textAlign === 'left') { textX = cursorX; }
				if (barcodeOptions.textAlign === 'right') { textX = cursorX + segmentWidth - textWidth; }
				var textBaselineFromTop = options.top + (
					barcodeOptions.marginTop + barcodeOptions.height + barcodeOptions.textMargin + barcodeOptions.fontSize
				) * scale;
				page.drawText(encoding.text, {
					x: textX,
					y: PAGE_HEIGHT - textBaselineFromTop,
					size: fontSize,
					font: options.font,
					color: options.color
				});
			}

			cursorX += segmentWidth;
		});
	}

	function drawWarningSymbol(page, black, yellow) {
		var x = 4.5;
		var top = 35.25;
		var scale = 0.15;
		var y = PAGE_HEIGHT - top;

		// Authored Buildbooks warning artwork from plabelWarning.svg.
		page.drawSvgPath('M3.4,93.7h93.3c1.2,0,2.3-0.6,2.9-1.7c0.6-1,0.6-2.3,0-3.4L52.9,7.8c-0.6-1-1.7-1.7-2.9-1.7c-1.2,0-2.3,0.6-2.9,1.7L0.5,88.6c-0.6,1-0.6,2.3,0,3.4C1.1,93,2.2,93.7,3.4,93.7z', {
			x: x,
			y: y,
			scale: scale,
			color: black
		});
		page.drawSvgPath('M50 16.3 L90.8 86.9 L9.2 86.9 Z', {
			x: x,
			y: y,
			scale: scale,
			color: yellow
		});
		page.drawSvgPath('M52.8,66.4l3.3-30.6c0.3-2.5-1-4.9-3.1-6.1c-2.2-1.2-4.9-1-6.9,0.5s-2.9,4.1-2.3,6.5l3.5,30.3c0.1,1,0.7,1.8,1.6,2.2c0.9,0.4,1.9,0.3,2.7-0.3C52.5,68.4,53,67.4,52.8,66.4', {
			x: x,
			y: y,
			scale: scale,
			color: black
		});
		page.drawCircle({
			x: x + 50 * scale,
			y: y - 76.3 * scale,
			size: 4.7 * scale,
			color: black
		});
	}

	function drawHandlingIcon(page, iconName, x, top, size, black) {
		if (iconName === 'hazard') {
			var y = PAGE_HEIGHT - top;
			page.drawSvgPath('M1 10 L5.25 1 L9.5 10 Z', {
				x: x,
				y: y,
				borderColor: black,
				borderWidth: 0.7
			});
			page.drawSvgPath('M4.9 4 L5.6 4 L5.45 7.2 L5.05 7.2 Z M5.05 8 L5.45 8 L5.45 8.6 L5.05 8.6 Z', {
				x: x,
				y: y,
				color: black
			});
			return;
		}

		var icon = ICON_PATHS[iconName];
		if (!icon) { return; }
		var scale = size / icon.viewBox;
		icon.paths.forEach(function (path) {
			page.drawSvgPath(path, {
				x: x,
				y: PAGE_HEIGHT - top,
				scale: scale,
				color: black
			});
		});
	}

	function drawHandlingIcons(page, handling, black) {
		var icons = [];
		if (handling.fragile) { icons.push('fragile'); }
		if (handling.storeDry) { icons.push('storeDry'); }
		if (handling.keepAwayFromFlame) { icons.push('keepAwayFromFlame'); }
		if (handling.toxic) { icons.push('toxic'); }
		if (handling.showHazardProfileIcon) { icons.push('hazard'); }
		if (icons.length === 0) { return; }

		var size = 10.5;
		var gap = 0.75;
		var rightEdge = PAGE_WIDTH - 106.5;
		var totalWidth = icons.length * size + (icons.length - 1) * gap;
		var x = rightEdge - totalWidth;
		icons.forEach(function (iconName) {
			drawHandlingIcon(page, iconName, x, 5.25, size, black);
			x += size + gap;
		});
	}

	function drawWarningCopy(page, fonts, colors, warning) {
		var x = 19;
		var top = 34.3;
		var label = 'WARNING:';
		var rest = ' ' + warning.headline.replace(/^WARNING:\s*/i, '');
		var size = 6.2;
		while (size > 4.8 && (
			fonts.bold.widthOfTextAtSize(label, size) + fonts.regular.widthOfTextAtSize(rest, size)
		) > 130) {
			size -= 0.1;
		}
		var labelWidth = fonts.bold.widthOfTextAtSize(label, size);
		drawTextFromTop(page, label, {
			x: x,
			top: top,
			size: size,
			font: fonts.bold,
			maxWidth: labelWidth,
			color: colors.black
		});
		drawTextFromTop(page, rest, {
			x: x + labelWidth,
			top: top,
			size: size,
			font: fonts.regular,
			maxWidth: 130 - labelWidth,
			color: colors.black
		});

		var detailSize = fitTextSize(warning.detail, fonts.regular, 6.8, 5, 87);
		var detailText = drawTextFromTop(page, warning.detail, {
			x: x,
			top: 42,
			size: detailSize,
			font: fonts.regular,
			maxWidth: 87,
			color: colors.black
		});
		var underlineWidth = fonts.regular.widthOfTextAtSize(detailText, detailSize);
		page.drawLine({
			start: { x: x, y: PAGE_HEIGHT - 49.5 },
			end: { x: x + underlineWidth, y: PAGE_HEIGHT - 49.5 },
			thickness: 0.4,
			color: colors.gray
		});
	}

	async function getLogoBytes() {
		if (!logoBytesPromise) {
			logoBytesPromise = fetch(new URL('favicon-256x256.png', assetBaseUrl)).then(function (response) {
				if (!response.ok) { throw new Error('Unable to load the Buildbooks label symbol.'); }
				return response.arrayBuffer();
			});
		}
		return logoBytesPromise;
	}

	async function getFontBytes() {
		if (!fontBytesPromise) {
			fontBytesPromise = Promise.all([
				'MiriamLibre-Regular.ttf',
				'MiriamLibre-Bold.ttf'
			].map(function (filename) {
				return fetch(new URL('fonts/' + filename, assetBaseUrl)).then(function (response) {
					if (!response.ok) { throw new Error('Unable to load the Buildbooks label font.'); }
					return response.arrayBuffer();
				});
			}));
		}
		return fontBytesPromise;
	}

	async function embedLabelFonts(pdfDoc) {
		pdfDoc.registerFontkit(requireDependency('fontkit', global.fontkit));
		var bytes = await getFontBytes();
		var fonts = await Promise.all([
			pdfDoc.embedFont(bytes[0], { subset: true }),
			pdfDoc.embedFont(bytes[1], { subset: true })
		]);
		return { regular: fonts[0], bold: fonts[1] };
	}

	async function buildPrimaryPdf(model) {
		var library = requireDependency('pdf-lib', global.PDFLib);
		var pdfDoc = await library.PDFDocument.create();
		var page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
		page.setMediaBox(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
		page.setCropBox(0, 0, PAGE_WIDTH, PAGE_HEIGHT);

		var fonts = await embedLabelFonts(pdfDoc);
		var colors = {
			black: library.rgb(0, 0, 0),
			gray: library.rgb(0.72, 0.72, 0.72),
			yellow: library.rgb(1, 1, 0)
		};

		pdfDoc.setTitle(model.sku + ' package label');
		pdfDoc.setAuthor('Buildbooks');
		pdfDoc.setSubject('3.5 x 1 inch package label');
		pdfDoc.setCreator('Buildbooks');
		pdfDoc.setProducer('pdf-lib 1.17.1');
		var viewerPreferences = pdfDoc.catalog.getOrCreateViewerPreferences();
		viewerPreferences.setPrintScaling(library.PrintScaling.None);
		viewerPreferences.setPickTrayByPDFSize(true);
		viewerPreferences.setDisplayDocTitle(true);

		drawTextFromTop(page, model.sku, {
			x: 7.5,
			top: 4.5,
			size: 15.75,
			font: fonts.bold,
			maxWidth: 135,
			color: colors.black
		});
		var descriptionSize = fitTextSize(model.description, fonts.bold, 9, 8, 142.5);
		drawTextFromTop(page, model.description, {
			x: 9,
			top: 22.5,
			size: descriptionSize,
			font: fonts.bold,
			maxWidth: 142.5,
			color: colors.black
		});

		drawWarningSymbol(page, colors.black, colors.yellow);
		drawWarningCopy(page, fonts, colors, model.warning);

		page.drawRectangle({
			x: 108.75,
			y: PAGE_HEIGHT - 49.5,
			width: 37.5,
			height: 7.5,
			borderColor: colors.gray,
			borderWidth: 0.75
		});
		var dateCodeWidth = fonts.regular.widthOfTextAtSize(model.dateCode, 6.75);
		page.drawText(model.dateCode, {
			x: 108.75 + (37.5 - dateCodeWidth) / 2,
			y: PAGE_HEIGHT - 48.7,
			size: 6.75,
			font: fonts.regular,
			color: colors.black
		});

		if (model.upcPayload) {
			var upcEncodings = encodeBarcode(model.upcPayload, {
				format: 'upc',
				width: 1.16,
				height: 52,
				fontSize: 12,
				textMargin: 1,
				margin: 6,
				displayValue: true,
				font: 'Miriam Libre'
			});
			var upcScale = PX_TO_PT;
			var upcWidth = barcodeWidth(upcEncodings, upcScale);
			drawBarcode(page, upcEncodings, {
				x: PAGE_WIDTH - upcWidth,
				top: -3.75,
				scale: upcScale,
				font: fonts.regular,
				color: colors.black
			});
		} else {
			var logoBytes = await getLogoBytes();
			var logo = await pdfDoc.embedPng(logoBytes);
			page.drawImage(logo, {
				x: 196,
				y: 18,
				width: 43.5,
				height: 43.5
			});
		}

		var code39Encodings = encodeBarcode(model.sku, {
			format: 'code39',
			width: 1,
			height: 26,
			displayValue: false,
			margin: 0,
			marginLeft: 10,
			marginRight: 10
		});
		drawBarcode(page, code39Encodings, {
			x: 0,
			top: 51.75,
			scale: PX_TO_PT,
			color: colors.black
		});

		if (model.countryOfOrigin || model.hazardName) {
			var metadataTop = 55.5;
			if (model.countryOfOrigin) {
				drawTextFromTop(page, 'COO: ' + model.countryOfOrigin, {
					x: 136.5,
					top: metadataTop,
					size: 6.75,
					font: fonts.regular,
					maxWidth: 109.5,
					color: colors.black
				});
				metadataTop += 7.5;
			}
			if (model.hazardName) {
				drawTextFromTop(page, 'Hazard: ' + model.hazardName, {
					x: 136.5,
					top: metadataTop,
					size: 6.75,
					font: fonts.bold,
					maxWidth: 109.5,
					color: colors.black
				});
			}
		}

		drawHandlingIcons(page, model.handling, colors.black);
		return pdfDoc.save();
	}

	function getFilename(model) {
		var safeSku = String(model.sku || 'label').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
		return 'buildbooks-' + safeSku + '-package-label.pdf';
	}

	async function downloadPrimaryPdf(model) {
		var bytes = await buildPrimaryPdf(model);
		var blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
		var download = document.createElement('a');
		download.href = blobUrl;
		download.download = getFilename(model);
		download.hidden = true;
		document.body.appendChild(download);
		download.click();
		download.remove();
		global.setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 30000);
		return { filename: getFilename(model), bytes: bytes };
	}

	global.BuildbooksLabelPdf = Object.freeze({
		buildPrimaryPdf: buildPrimaryPdf,
		downloadPrimaryPdf: downloadPrimaryPdf,
		getFilename: getFilename,
		pageSize: Object.freeze({ width: PAGE_WIDTH, height: PAGE_HEIGHT })
	});
})(window);
