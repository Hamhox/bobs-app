
   
	//
	// The bb variable is the master object that holds all the app objects and functions, stay tidy everybody!
	//
	var bb = {};
		bb.ele = {}; // used as a container for app level dom references
		bb.ajax = {}; // used as a container for ajax functions and file blobs
		bb.dry = {}; // a place to hold the dry functions... ones without application-specific variables
		bb.sku = {}; // this is the active/loaded/selected sku... whenever you need info about the active sku, get it here
		bb.imageAdminBusy = false;
		bb.imageUploadStatusTimer = null;
		bb.localSkuImages = Object.create(null);
		bb.hiddenImagePaths = Object.create(null);

	//
	// kicks off as soon as possible when everything is loaded
	window.addEventListener('DOMContentLoaded', function() {
		console.log("bb DOMContentLoaded!");
		
		bb.urlQueryItem = bb.dry.getUrlQueryStr('item') || 'QAR-0001';
		bb.urlQuerySearch = bb.dry.getUrlQueryStr('search');
		bb.urlQueryTab = bb.dry.getUrlQueryStr('tab') || '1';
		bb.ele.buttonTab = document.getElementById('button_tab' + bb.urlQueryTab);
		
		//
		// register selected sku members
		bb.sku.value = "";
		bb.sku.imgPath = "";
		bb.sku.vendor = "";
		bb.sku.name = "";
		bb.sku.img = "";
		bb.sku.coo = "";
		
		//
		// register html elements
		bb.ele.body 			= document.getElementsByTagName("body")[0];
		bb.ele.topbar 			= document.getElementById("topbar");
		
		bb.ele.mainShipButton	= document.getElementById('mainShipButton');
		bb.ele.shareLink		= document.getElementById('shareLink');
		bb.ele.toolsMenuButton	= document.getElementById('toolsMenuButton');
		bb.ele.toolsMenu		= document.getElementById('toolsMenu');
		bb.ele.sidebar			= document.getElementById('sidebar');
		bb.ele.browserError		= document.getElementById('browserError');
		bb.ele.main 			= document.getElementById('main');
		bb.ele.mainTop			= document.getElementById('mainTop');
		bb.ele.headerImageViewer			= document.getElementById('headerImageViewer');
		
	//	bb.ele.mainTopImgNotes	= document.getElementById('mainTopImgNotes');
		bb.ele.buttonHideSidebar = document.getElementById('buttonHideSidebar');
		bb.ele.skuSelectBox 	= document.getElementById("SKUselect");
		bb.ele.searchInput 		= document.getElementById('sidebarSearchInput');
			bb.ele.searchInput.value = ''; // without this the search box isn't cleared on page refresh
		bb.ele.clickHistory		= document.getElementById('clickHistory');
		
	//	bb.ele.img 				= document.getElementById('mainTopImg');
		bb.ele.sku 				= document.getElementById('containerHeaderTitle');
		bb.ele.vendor 			= document.getElementById('selectedVendor');
		bb.ele.upc 				= document.getElementById('selectedUpc');
		bb.ele.name 			= document.getElementById('selectedItemName');
		bb.ele.notesimg 		= document.getElementById('notesTopImg');
		bb.ele.imageUploadButton = document.getElementById('buttonUploadImage');
		bb.ele.imageDeleteButton = document.getElementById('buttonDeleteImage');
		bb.ele.imageZoomButton = document.getElementById('buttonZoomImage');
		bb.ele.imageToolsToggle = document.getElementById('buttonImageTools');
		bb.ele.imageToolActions = document.getElementById('imageToolActions');
		bb.ele.imageUploadInput = document.getElementById('inputUploadImage');
		bb.ele.imageUploadStatus = document.getElementById('imageUploadStatus');
		bb.ele.mainHeaderImg = document.getElementById('mainHeaderImg');
		bb.ele.imageZoomModal = document.getElementById('imageZoomModal');
		bb.ele.imageZoomPreview = document.getElementById('imageZoomPreview');
		bb.ele.imageZoomCloseButton = document.getElementById('buttonCloseImageZoom');
		bb.ele.imageDeleteModal = document.getElementById('imageDeleteModal');
		bb.ele.imageDeleteModalText = document.getElementById('imageDeleteModalText');
		bb.ele.imageDeleteConfirmButton = document.getElementById('buttonConfirmDeleteImage');
		bb.ele.imageDeleteCancelButton = document.getElementById('buttonCancelDeleteImage');
		bb.ele.criticalNotesAdminSku = document.getElementById('criticalNotesAdminSku');
		bb.ele.criticalNotesCountryOfOrigin = document.getElementById('criticalNotesCountryOfOrigin');
		bb.ele.criticalNotesFragileCheckbox = document.getElementById('criticalNotesFragileCheckbox');
		bb.ele.criticalNotesStoreDryCheckbox = document.getElementById('criticalNotesStoreDryCheckbox');
		bb.ele.criticalNotesKeepAwayFromFlameCheckbox = document.getElementById('criticalNotesKeepAwayFromFlameCheckbox');
		bb.ele.criticalNotesHazardProfile = document.getElementById('criticalNotesHazardProfile');
		bb.ele.criticalNotesText = document.getElementById('criticalNotesText');
		bb.ele.criticalNotesSaveButton = document.getElementById('buttonSaveCriticalNotes');
		bb.ele.criticalNotesSaveStatus = document.getElementById('criticalNotesSaveStatus');
		
		bb.ele.tab1 			= document.getElementById('tab1');
			bb.ele.tab1.button 	= document.getElementById('button_tab1');
			bb.ele.tab1.header 	= bb.ele.tab1.getElementsByTagName("p")[0];
			bb.ele.tab1.content = bb.ele.tab1.getElementsByTagName("div")[0];
			bb.ele.tab1.error   = bb.ele.tab1.getElementsByTagName("span")[0];
			bb.ele.tab1.showErrorBom   = document.getElementById("showErrorBom");
		
		bb.ele.tab2 			= document.getElementById('tab2');
			bb.ele.tab2.button 	= document.getElementById('button_tab2');
			bb.ele.tab2.header 	= bb.ele.tab2.getElementsByTagName("p")[0];
			bb.ele.tab2.content = bb.ele.tab2.getElementsByTagName("div")[0];
			
		bb.ele.tab3 			= document.getElementById('tab3');
			bb.ele.tab3.button 	= document.getElementById('button_tab3');
			bb.ele.tab3.header 	= bb.ele.tab3.getElementsByTagName("p")[0];
			bb.ele.tab3.content = bb.ele.tab3.getElementsByTagName("div")[0];
			bb.ele.printQty = document.getElementById('inputPrintQty');
			bb.ele.printButton = document.getElementById('printButton');
			//bb.ele.barcodeContainer = document.getElementById('barcodeContainer');
			bb.ele.labelCriticalContainer = document.getElementById('labelCriticalContainer');
			bb.ele.labelCriticalNote = document.getElementById('labelCriticalNote');
			bb.ele.printContainer = document.getElementById('printContainer');
			bb.ele.labelFragileIcon = document.getElementById('labelFragileIcon');
			bb.ele.labelStoreDryIcon = document.getElementById('labelStoreDryIcon');
			bb.ele.labelKeepAwayFromFlameIcon = document.getElementById('labelKeepAwayFromFlameIcon');
			bb.ele.labelHazardProfileIcon = document.getElementById('labelHazardProfileIcon');
			bb.ele.fragileLabel = document.getElementById('fragileLabelContainer');
			bb.ele.storeDryLabel = document.getElementById('storeDryLabelContainer');
			bb.ele.keepAwayFromFlameLabel = document.getElementById('keepAwayFromFlameLabelContainer');
			bb.ele.hazardProfileLabel = document.getElementById('hazardProfileLabelContainer');
			bb.ele.hazardProfileLabelTitle = document.getElementById('hazardProfileLabelTitle');
			bb.ele.hazardProfileLabelBody = document.getElementById('hazardProfileLabelBody');
			
	//	bb.ele.tab4 			= document.getElementById('tab4');
	//		bb.ele.tab4.button 	= document.getElementById('button_tab4');
	//		bb.ele.tab4.header 	= bb.ele.tab4.getElementsByTagName("p")[0];
	//		bb.ele.tab4.content = bb.ele.tab4.getElementsByTagName("div")[0];


		// IE should not be used with this application. It is too non compliant.
		if (bb.dry.GetIEVersion() > 0) {
		   bb.ele.sidebar.style.visibility = "hidden";
		   bb.ele.main.style.visibility = "hidden";
		   bb.ele.buttonHideSidebar.style.visibility = "hidden";
		   bb.ele.browserError.style.display = "block";
		   return;
		}
		
		bb.ele.buttonTab.click();
		//bb.ele.tab1.button.click(); // click on the default tab (Assembly), without this it sticks to last viewed tab
		
		//
		// wire the search box to update the sku box each time a character is typed
		bb.ele.searchInput.oninput = bb.dry.debounce(bb.dry.searchInputChange, 250);
		bb.dry.syncSkuSelectSize();
		var syncSkuSelectSizeDebounced = bb.dry.debounce(bb.dry.syncSkuSelectSize, 100);
		var skuSelectMediaQuery = window.matchMedia ? window.matchMedia("(max-width: 720px)") : null;
		window.addEventListener('resize', syncSkuSelectSizeDebounced, false);
		if (window.visualViewport) {
			window.visualViewport.addEventListener('resize', syncSkuSelectSizeDebounced, false);
		}
		if (skuSelectMediaQuery && skuSelectMediaQuery.addEventListener) {
			skuSelectMediaQuery.addEventListener('change', bb.dry.syncSkuSelectSize, false);
		} else if (skuSelectMediaQuery && skuSelectMediaQuery.addListener) {
			skuSelectMediaQuery.addListener(bb.dry.syncSkuSelectSize);
		}
		window.addEventListener('orientationchange', bb.dry.syncSkuSelectSize, false);
		
		//
		// hide sidebar when 3 dots icon is clicked
		bb.dry.addClickListener({'ele':bb.ele.buttonHideSidebar, 'group':'', 'callback':'hideSidebar' });
		//
		// show bom underneath error message when there are overlapping boms
		bb.dry.addClickListener({'ele':bb.ele.tab1.showErrorBom, 'group':'', 'callback':'showErrorBom' });
		//
		// show hidden tabs when you click on the pageLogo
	//	bb.dry.addClickListener({'ele':bb.ele.pageLogo, 'group':'', 'callback':'showHiddenTabs' });
		//
		// register dry strings
		bb.dry.imgBroken = "assets/noimage.svg";
		bb.dry.classBroken = "noBlueHyperlinkBorder";
		bb.dry.assemblyId = 0; // start counter to make unique id's for assembly list blocks
		
		bb.dry.clickHistory = [];
		
		//
		// Configure the single Buildbooks dataset before requesting its files.
		bb.dry.configureDataSources();
		
		//console.log(bb.ajax.path1);
		console.log('Requesting Buildbooks Ajax Files...')
		bb.ajax.fileData = {};
		bb.ajax.promises=3;
		bb.ajax.requestFile({'tag':'assembliesCSV', 'path':bb.ajax.path1, 'type':'str'});
		bb.ajax.requestFile({'tag':'inventoryCSV', 'path':bb.ajax.path2, 'type':'str'});
		bb.ajax.requestFile({'tag':'criticalNoteCSV', 'path':bb.ajax.path3, 'type':'str'});
	
	
		
		var clipboard = new ClipboardJS('#shareLink');
		
		// AI success messaging
		clipboard.on('success', function(e) {
		  bb.dry.showQuickFeedback("🔗 Copied!");
		  e.clearSelection();
		});
		clipboard.on('error', function(e) {
		  bb.dry.showQuickFeedback("🔗 Failed to Copy Link!");
		});
			
		bb.ele.shareLink.addEventListener("click", function(evn) {
			bb.dry.updateLinks();
		}, true);

		if (bb.ele.mainShipButton) {
			bb.ele.mainShipButton.addEventListener("click", function() {
				bb.ele.skuSelectBox.value = "QAR-0001";
				bb.ele.tab1.button.click();
				window.history.pushState({}, "", "/apps/buildbooks/bb?item=QAR-0001&tab=1");
				bb.ele.skuSelectBox.dispatchEvent(new Event("change"));
			}, false);
		}

		if (bb.ele.toolsMenuButton && bb.ele.toolsMenu) {
			bb.ele.toolsMenuButton.addEventListener("click", function(evn) {
				evn.stopPropagation();
				var isOpen = bb.ele.toolsMenu.classList.toggle("open");
				bb.ele.toolsMenuButton.setAttribute("aria-expanded", isOpen ? "true" : "false");
			}, false);

			bb.ele.toolsMenu.addEventListener("click", function(evn) {
				evn.stopPropagation();
			}, false);

			document.addEventListener("click", function() {
				bb.ele.toolsMenu.classList.remove("open");
				bb.ele.toolsMenuButton.setAttribute("aria-expanded", "false");
			}, false);

			document.addEventListener("keydown", function(evn) {
				if (evn.key === "Escape") {
					bb.ele.toolsMenu.classList.remove("open");
					bb.ele.toolsMenuButton.setAttribute("aria-expanded", "false");
				}
			}, false);
		}

		//
		// AI wire up the accordion
		// 
		document.querySelectorAll(".accordion").forEach(acc => {
		  acc.setAttribute('tabindex', '0'); // Make accordion buttons keyboard navigable
		  acc.addEventListener("click", toggleAccordion);
		  acc.addEventListener("keydown", function(e) {
			if (e.key === 'Enter' || e.key === ' ') {
			  e.preventDefault();
			  toggleAccordion.call(this);
			}
		  });
		});

		function toggleAccordion() {
		  this.classList.toggle("active");
		  this.nextElementSibling.classList.toggle("active");
		}
		// accordion end
		
		// AI: Add keyboard support for tabs
		document.querySelectorAll('.tablinks').forEach(tab => {
		  tab.setAttribute('tabindex', '0');  // Make tabs keyboard navigable
		  tab.addEventListener('keydown', function(e) {
			if (e.key === 'Enter' || e.key === ' ') {
			  this.click();
			}
		  });
		});

		if (bb.ele.imageToolsToggle && bb.ele.imageToolActions) {
			bb.ele.imageToolsToggle.addEventListener('click', function(evn) {
				evn.stopPropagation();
				bb.dry.setImageToolsOpen(bb.ele.imageToolActions.hidden);
			}, false);
			bb.ele.imageToolActions.addEventListener('click', function(evn) {
				evn.stopPropagation();
			}, false);
			document.addEventListener('click', bb.dry.closeImageTools, false);
		}
		if (bb.ele.imageUploadButton) {
			bb.ele.imageUploadButton.addEventListener('click', function() {
				bb.dry.closeImageTools();
				bb.dry.uploadSkuImage();
			}, false);
		}
		if (bb.ele.imageUploadInput) {
			bb.ele.imageUploadInput.addEventListener('change', bb.dry.handleImageUpload, false);
		}
		if (bb.ele.imageDeleteButton) {
			bb.ele.imageDeleteButton.addEventListener('click', function() {
				bb.dry.closeImageTools();
				bb.dry.openDeleteImageModal();
			}, false);
		}
		if (bb.ele.imageZoomButton) {
			bb.ele.imageZoomButton.addEventListener('click', bb.dry.openImageZoom, false);
		}
		if (bb.ele.imageZoomCloseButton) {
			bb.ele.imageZoomCloseButton.addEventListener('click', bb.dry.closeImageZoom, false);
		}
		if (bb.ele.imageZoomModal) {
			bb.ele.imageZoomModal.addEventListener('click', function(evn) {
				if (evn.target === bb.ele.imageZoomModal) { bb.dry.closeImageZoom(); }
			}, false);
		}
		if (bb.ele.imageDeleteCancelButton) {
			bb.ele.imageDeleteCancelButton.addEventListener('click', bb.dry.closeDeleteImageModal, false);
		}
		if (bb.ele.imageDeleteConfirmButton) {
			bb.ele.imageDeleteConfirmButton.addEventListener('click', bb.dry.deleteSkuImage, false);
		}
		if (bb.ele.criticalNotesSaveButton) {
			bb.ele.criticalNotesSaveButton.addEventListener('click', bb.dry.saveCriticalNotes, false);
		}
		document.addEventListener('keydown', function(evn) {
			if (evn.key !== 'Escape') { return; }
			bb.dry.closeImageTools();
			bb.dry.closeImageZoom();
		}, false);
	})

	//
	// user clicked on a label, intending to print it
	// First determine which label was clicked on, then update it to the printable area div, then print
bb.dry.sendPrint = function (userClicked) {
	var printTargets = {
		pLabel: '#plabelPrintDivs',
		fragileLabel: '#fragileLabelPrintDivs',
		storeDryLabel: '#storeDryLabelPrintDivs',
		keepAwayFromFlameLabel: '#keepAwayFromFlameLabelPrintDivs',
		hazardProfileLabel: '#hazardProfileLabelPrintDivs'
	};
	var printDivs = document.querySelector(printTargets[userClicked] || printTargets.pLabel);
	if (!printDivs) { return; }

	var printarea = document.querySelector('#printarea');
	printarea.innerHTML = '';
	printarea.appendChild(printDivs.cloneNode(true));

	window.print();

	bb.dry.showQuickFeedback("Label sent to printer!");
}

bb.dry.showQuickFeedback = function(message) {
  let feedback = document.createElement('div');
  feedback.textContent = message;
  feedback.style.cssText = `
    position: fixed; top: 60px; right: 20px; 
    background: #4CAF50; color: #fff; padding: 10px 15px; 
    border-radius: 5px; box-shadow: 0 2px 6px rgba(0,0,0,.3); 
    z-index: 9999; transition: opacity 0.5s;
  `;
  document.body.appendChild(feedback);
  setTimeout(() => feedback.style.opacity = '0', 1500);
  setTimeout(() => feedback.remove(), 2000);
}	

bb.dry.setImageVersion = function(version) {
	version = version ? String(version).trim() : "";
	bb.imageVersion = version || String(Date.now());
}

bb.dry.refreshImageVersion = function(callback) {
	var xhr = new XMLHttpRequest();
	xhr.onreadystatechange = function() {
		if (this.readyState != 4) { return; }
		if (this.status == 200 && this.responseText) {
			bb.dry.setImageVersion(this.responseText);
		} else {
			bb.dry.setImageVersion("");
		}
		if (typeof callback === 'function') {
			callback();
		}
	}
	xhr.open("GET", "images/image-version.txt?cache=" + Date.now(), true);
	xhr.send();
}

bb.dry.versionedImageUrl = function(path) {
	if (!path || path.indexOf('assets/') === 0) { return path; }

	var version = bb.imageVersion || String(Date.now());
	var separator = path.indexOf('?') >= 0 ? '&' : '?';
	return path + separator + 'v=' + encodeURIComponent(version);
}

	//
	// update the page with a new sku
	bb.dry.loadSku = function (sku, imageVersionReady) {
		// start loading the new sku by validating it
		if (sku.value == "") { // no sku was clicked on at page load
			return false;
		}
		console.log("Clicked on " + sku.value)
		if (typeof sku.selectedIndex !== 'undefined') { // These are select box links
			sku.value = sku.options[sku.selectedIndex].value;
		} else if (typeof sku.value !== 'undefined') {
			//console.log("Found " + sku.value)
			// let it pass through without the return false.  These are breadcrumb links etc
		} else {
			console.log('SKU is undefined.')
			return false;
		}
		if (sku.value == "undefined") { // sometimes sku might be defined as the string "undefined"
			console.log('SKU not found in list: ' + sku.value)
			return false;
		}

		if (!imageVersionReady) {
			bb.pendingLoadSkuValue = sku.value;
			bb.dry.refreshImageVersion(function() {
				if (bb.pendingLoadSkuValue == sku.value) {
					bb.dry.loadSku({ value: sku.value }, true);
				}
			});
			return false;
		}
		
		
		//
		// update breadcrumbs
		bb.dry.clickHistory.push("<a class='breadcrumbs'>" + sku.value + "</a>");
		if (bb.dry.clickHistory.length > 8) { bb.dry.clickHistory.shift(); } // shave the list to N items
		bb.ele.clickHistory.innerHTML = bb.dry.clickHistory.join(", "); // refresh the displayed html list

		var breadcrumbs = document.getElementsByClassName('breadcrumbs');
		for(var i = 0; i < breadcrumbs.length; i++) { // attach click listener to breadcrumbs
			breadcrumbs[i].addEventListener('click', function() {
				this.value = this.innerHTML; // set sku value to imitate the select box value
				bb.dry.loadSku(this); // triggers new sku to load when you click on the breadcrumb
			}, false);
		}
		
		
		//
		// lookup the values for the passed sku in the inventory table
		bb.sku.imgPath = ""; 
		bb.sku.vendor = ""; 
		bb.sku.name = ""; 
		bb.sku.upc = ""; 
		bb.sku.coo = ""; 
		bb.sku.currentImage = null;
		bb.dry.updateImageAdminButtons();
		
		for (var i = 0; i < bb.ajax.inventory.length; i++) { // loop through the inventory array to find the lines with the passed sku
			if(bb.ajax.inventory[i].LocalSKU == sku.value) { // check if the passed sku is this line of the inventory table... could be multiples
				bb.sku.value 	= bb.ajax.inventory[i].LocalSKU;
				bb.sku.name 	= bb.ajax.inventory[i].ItemName;
				bb.sku.vendor 	= bb.ajax.inventory[i].Vendor;
				bb.sku.coo 		= bb.dry.getInventoryCoo(bb.ajax.inventory[i]);
				bb.sku.upc 		= Number(bb.ajax.inventory[i].UPC) + ""; // remove leading zeros and convert to string
				bb.sku.upc		= bb.sku.upc.slice(0, -1); // remove rightmost character... its the checkdigit thats in the gtin, but we don't want to pass that part to JSBarcode
				bb.sku.upc		= "0" + bb.sku.upc; // add a leading zero to finish converting the gtin into a upc
				
			}
		}
		var criticalNoteRow = bb.dry.getCriticalNoteRow(sku.value);
		if (criticalNoteRow && criticalNoteRow.CountryOfOrigin) {
			bb.sku.coo = String(criticalNoteRow.CountryOfOrigin).trim();
		}
		//
		// update the displayed values with the fresh sku information
		bb.dry.updateEle(bb.ele.tab1.header, 	'List of parts used to assemble: '+ sku.value);
		bb.dry.updateEle(bb.ele.tab2.header, 	'List of assemblies that contain: '+ sku.value);
		bb.dry.updateEle(bb.ele.sku, 			bb.sku.value);
		bb.dry.updateEle(bb.ele.vendor, 		bb.sku.vendor);
		bb.dry.updateEle(bb.ele.name, 			bb.sku.name);
		bb.dry.updateEle(bb.ele.upc, 			bb.sku.upc);




		//bb.sku.imgPath = "images/"+ encodeURIComponent(bb.sku.value.trim()).toLowerCase() +".jpg"; // switch spaces to %20, etc
		// ai
			bb.sku.imgPath = `images/custom/${encodeURIComponent(bb.sku.value.trim()).toLowerCase()}.jpg`;

	//	bb.ele.img.parentNode.href = bb.sku.imgPath;
	//	bb.dry.updateImageSrc(bb.ele.img, bb.sku.value)
		
		//
		// update the href for the link over to the crn version of this item, and the share link
		bb.dry.updateLinks();
		
		
		//
		// Loop through and add assembly cards to tab1 and tab2 content
		bb.ele.tab1.content.innerHTML = ""; // clear assemblies tab
		bb.ele.tab2.content.innerHTML = ""; // clear usedin tab
		bb.ele.tab1.error.style.display = "none"; // hide overlapping boms error message
		bb.ele.tab1.content.style.display = "block"; // show content if previously hidden
		
		//
		// Load notes images in to right corner
	//	while (bb.ele.mainTopImgNotes.firstChild) {
	//		bb.ele.mainTopImgNotes.removeChild(bb.ele.mainTopImgNotes.firstChild);
	//	}
		bb.dry.loadSkuImages(bb.sku.value);
		
		//
		// add images to tab 1 and 2
		// ai
for (var i = 0; i < bb.ajax.assemblies.length; i++) { 
  const assemblyExists = bb.ajax.inventorySkus.includes(bb.ajax.assemblies[i].AssemblySKU);
  const partExists = bb.ajax.inventorySkus.includes(bb.ajax.assemblies[i].PartSKU);

  if(bb.ajax.assemblies[i].AssemblySKU == bb.sku.value && partExists) { 
    bb.dry.createListBlock(bb.ajax.assemblies[i], bb.ajax.assemblies[i].PartSKU, bb.ele.tab1.content);
  }

  if(bb.ajax.assemblies[i].PartSKU == bb.sku.value && assemblyExists) { 
    bb.dry.createListBlock(bb.ajax.assemblies[i], bb.ajax.assemblies[i].AssemblySKU, bb.ele.tab2.content);
  }
}


		//
		// update the labels on tab3
		bb.dry.makeLabelPreview();
		bb.dry.populateCriticalNotesAdmin();
		bb.dry.applyCriticalNotesForSku();


	}
	

bb.dry.getCriticalNoteRow = function(sku) {
	if (!sku || !bb.ajax.criticalNote) { return null; }
	for (var i = 0; i < bb.ajax.criticalNote.length; i++) {
		if (bb.ajax.criticalNote[i].LocalSKU == sku) {
			return bb.ajax.criticalNote[i];
		}
	}
	return null;
}

bb.dry.criticalNoteHtmlToText = function(noteHtml) {
	if (!noteHtml) { return ""; }
	return noteHtml.replace(/<br\s*\/?>/gi, "\n");
}

bb.dry.populateCriticalNotesAdmin = function() {
	if (!bb.ele.criticalNotesAdminSku) { return; }

	var row = bb.dry.getCriticalNoteRow(bb.sku.value) || {};

	bb.ele.criticalNotesAdminSku.textContent = bb.sku.value || "selected SKU";
	bb.ele.criticalNotesCountryOfOrigin.value = row.CountryOfOrigin || "";
	bb.ele.criticalNotesFragileCheckbox.checked = row.Fragile == "1";
	bb.ele.criticalNotesStoreDryCheckbox.checked = row.StoreDry == "1";
	bb.ele.criticalNotesKeepAwayFromFlameCheckbox.checked = row.KeepAwayFromFlame == "1";
	bb.ele.criticalNotesHazardProfile.value = row.HazardProfile || "";
	bb.ele.criticalNotesText.value = row.CriticalNote ? bb.dry.criticalNoteHtmlToText(row.CriticalNote) : "";
	bb.ele.criticalNotesSaveStatus.textContent = "";
	bb.ele.criticalNotesSaveButton.disabled = !bb.sku.value;
}

bb.dry.getHazardLabel = function(hazardProfile) {
	var labels = {
		AMMUNITION: ['AMMUNITION STORES', 'KEEP DRY · SEGREGATE FROM IGNITION SOURCES · VERIFY COUNT'],
		COMBUSTIBLE: ['COMBUSTIBLE STORES', 'KEEP COOL · VENTILATE · SEPARATE FROM IGNITION SOURCES'],
		CONTROLLED_MEDICAL: ['CONTROLLED MEDICAL STORES', 'KEEP SEALED · RESTRICT ACCESS'],
		EXPLOSIVE: ['EXPLOSIVE STORES', 'ISOLATE FROM FLAME, SPARKS, IMPACT AND UNAUTHORIZED HANDLING'],
		FLAMMABLE: ['FLAMMABLE STORES', 'KEEP SEALED · KEEP AWAY FROM FLAME AND SPARKS'],
		ORDNANCE: ['HEAVY ORDNANCE', 'SECURE AGAINST MOVEMENT · INSPECT BEFORE ISSUE'],
		SHARP_EDGE: ['SHARP EDGE OR POINT', 'KEEP SHEATHED OR SECURED · INSPECT BEFORE ISSUE'],
		TOXIC: ['TOXIC MATERIAL', 'DO NOT INGEST OR INHALE · KEEP SEALED · RESTRICT ACCESS']
	};
	return labels[hazardProfile] || ['HAZARD PROFILE', 'FOLLOW THE CRITICAL HANDLING NOTE'];
}

bb.dry.applyCriticalNotesForSku = function() {
	var needsCriticalNote = false;
	var needsFragileLabel = false;
	var needsStoreDryLabel = false;
	var needsKeepAwayFromFlameLabel = false;
	var hazardProfile = "";
	var row = bb.dry.getCriticalNoteRow(bb.sku.value);

	if (row) {
		if (typeof row.CriticalNote !== 'undefined' && row.CriticalNote !== "") {
			needsCriticalNote = true;
			bb.ele.labelCriticalNote.innerHTML = row.CriticalNote;
		} else {
			bb.ele.labelCriticalNote.innerHTML = "No critical note specified.";
		}
		needsFragileLabel = row.Fragile == "1";
		needsStoreDryLabel = row.StoreDry == "1";
		needsKeepAwayFromFlameLabel = row.KeepAwayFromFlame == "1";
		hazardProfile = row.HazardProfile ? String(row.HazardProfile).trim().toUpperCase() : "";
	} else {
		bb.ele.labelCriticalNote.innerHTML = "No critical note specified.";
	}

	if (needsCriticalNote == true) {
		bb.ele.labelCriticalContainer.style.display = "block";
		bb.ele.printContainer.style.display = "none";
	} else {
		bb.ele.labelCriticalContainer.style.display = "none";
		bb.ele.printContainer.style.display = "block";
	}
	bb.ele.labelFragileIcon.style.display = needsFragileLabel ? "block" : "none";
	bb.ele.labelStoreDryIcon.style.display = needsStoreDryLabel ? "block" : "none";
	bb.ele.labelKeepAwayFromFlameIcon.style.display = needsKeepAwayFromFlameLabel ? "block" : "none";
	bb.ele.labelHazardProfileIcon.style.display = hazardProfile ? "block" : "none";
	bb.ele.fragileLabel.style.display = needsFragileLabel ? "inline-block" : "none";
	bb.ele.storeDryLabel.style.display = needsStoreDryLabel ? "inline-block" : "none";
	bb.ele.keepAwayFromFlameLabel.style.display = needsKeepAwayFromFlameLabel ? "inline-block" : "none";
	bb.ele.hazardProfileLabel.style.display = hazardProfile ? "inline-block" : "none";

	var hazardLabel = bb.dry.getHazardLabel(hazardProfile);
	bb.ele.hazardProfileLabelTitle.textContent = hazardLabel[0];
	bb.ele.hazardProfileLabelBody.textContent = hazardLabel[1];
	bb.ele.labelHazardProfileIcon.setAttribute('aria-label', hazardProfile ? hazardLabel[0] : 'Hazard profile');
}

bb.dry.updateCriticalNoteMemory = function(sku, row) {
	if (!bb.ajax.criticalNote) { bb.ajax.criticalNote = []; }

	for (var i = bb.ajax.criticalNote.length - 1; i >= 0; i--) {
		if (bb.ajax.criticalNote[i].LocalSKU == sku) {
			bb.ajax.criticalNote.splice(i, 1);
		}
	}

	if (row) {
		bb.ajax.criticalNote.push(row);
	}
}

bb.dry.saveCriticalNotes = function() {
	if (!bb.sku.value) {
		bb.ele.criticalNotesSaveStatus.textContent = "Select a SKU first.";
		return;
	}

	bb.ele.criticalNotesSaveButton.disabled = true;
	bb.ele.criticalNotesSaveStatus.textContent = "Applying locally...";

	var editedSku = bb.sku.value;
	var noteText = bb.ele.criticalNotesText.value.trim();
	var row = {
		LocalSKU: editedSku,
		CountryOfOrigin: bb.ele.criticalNotesCountryOfOrigin.value.trim(),
		Fragile: bb.ele.criticalNotesFragileCheckbox.checked ? "1" : "0",
		StoreDry: bb.ele.criticalNotesStoreDryCheckbox.checked ? "1" : "0",
		KeepAwayFromFlame: bb.ele.criticalNotesKeepAwayFromFlameCheckbox.checked ? "1" : "0",
		HazardProfile: bb.ele.criticalNotesHazardProfile.value,
		CriticalNote: noteText.replace(/\r?\n/g, "<br>")
	};

	setTimeout(function() {
		bb.dry.updateCriticalNoteMemory(editedSku, row);

		if (bb.sku.value === editedSku) {
			bb.sku.coo = row.CountryOfOrigin;
			bb.dry.makeLabelPreview();
			bb.dry.applyCriticalNotesForSku();
			bb.ele.criticalNotesSaveStatus.textContent = "Applied for this browser session.";
			bb.ele.criticalNotesSaveButton.disabled = false;
		}

		bb.dry.showQuickFeedback("Label configuration applied locally.");
	}, 450);
}


bb.dry.loadSkuImages = function(targetSKU) {
    const sku = encodeURIComponent(targetSKU.trim()).toLowerCase();
	const skuKey = targetSKU.trim().toUpperCase();
    const loadingSKU = sku;
    bb.currentLoadingSKU = sku;

    const imageGroups = [
        { stack: 'C', source: 'custom', basePath: `images/custom/${sku}` },
        { stack: 'E', source: 'ecom', basePath: `images/ecom/${sku}` }
    ];

    const mainImg = document.getElementById('mainHeaderImg');
    const mainImgLink = document.getElementById('mainHeaderImgLink');
    const thumbContainer = document.getElementById('thumbnailContainer');
    thumbContainer.innerHTML = '';
    mainImg.src = bb.dry.imgBroken;
	bb.sku.currentImage = null;
	if (mainImgLink) {
	  mainImgLink.removeAttribute('href');
	  mainImgLink.style.pointerEvents = 'none';
	  mainImgLink.style.cursor = 'default';
	}
	bb.dry.updateImageAdminButtons();

    let mainImageSet = false;

    function withCacheBust(path) {
        return bb.dry.versionedImageUrl(path);
    }

    function addThumbnail(src, imageMeta, done) {
		const thumbImg = document.createElement('img');
		thumbImg.className = 'thumb';
		thumbImg.src = src;

		const thumbWrapper = document.createElement('a');
		thumbWrapper.classList.add('thumb-wrapper');

		thumbWrapper.onclick = function(e) {
			e.preventDefault();
			mainImg.src = thumbImg.src;
			bb.sku.currentImage = imageMeta;
			bb.dry.updateImageAdminButtons();

			document.querySelectorAll('.thumb-wrapper').forEach(function(thumb) { thumb.classList.remove('active'); });
			thumbWrapper.classList.add('active');
			mainImgLink.href = thumbImg.src;
			mainImgLink.style.pointerEvents = 'auto';
			mainImgLink.style.cursor = 'pointer';
		};

		thumbImg.onload = function() {
			if (bb.currentLoadingSKU !== loadingSKU) { return; }
			thumbWrapper.appendChild(thumbImg);
			thumbContainer.appendChild(thumbWrapper);
			if (!mainImageSet) {
				mainImageSet = true;
				thumbWrapper.click();
			}
			if (typeof done === 'function') { done(true); }
		};

		thumbImg.onerror = function() {
			if (typeof done === 'function') { done(false); }
		};
	}

    function loadSequential(group, index = 0, done = function(){}) {
        const imgPathNoCache = index === 0
            ? `${group.basePath}.jpg`
            : `${group.basePath}_${index}.jpg`;
		if (bb.hiddenImagePaths[imgPathNoCache]) {
			loadSequential(group, index + 1, done);
			return;
		}
        const imgPath = withCacheBust(imgPathNoCache);
        const fileName = imgPathNoCache.split('/').pop();

		addThumbnail(imgPath, {
			source: group.source,
			sku: targetSKU,
			skuKey: sku,
			index: index,
			filename: fileName,
			path: imgPathNoCache
		}, function(loaded) {
			if (loaded) {
				loadSequential(group, index + 1, done);
			} else {
				done();
			}
		});
    }

    function loadGroup(groupIndex) {
        if (groupIndex >= imageGroups.length) { return; }
        loadSequential(imageGroups[groupIndex], 0, function() {
            loadGroup(groupIndex + 1);
        });
    }

	const localImage = bb.localSkuImages[skuKey];
	if (localImage) {
		addThumbnail(localImage.url, {
			source: 'local',
			sku: targetSKU,
			skuKey: sku,
			index: 0,
			filename: localImage.name,
			path: localImage.url,
			isLocal: true
		}, function() { loadGroup(0); });
	} else {
		loadGroup(0);
	}

	mainImg.onerror = function() {
	  mainImg.src = bb.dry.imgBroken;
	  bb.sku.currentImage = null;
	  bb.dry.updateImageAdminButtons();

	  const mainImgLink = document.getElementById('mainHeaderImgLink');
	  mainImgLink.removeAttribute('href');
	  mainImgLink.style.pointerEvents = 'none';
	  mainImgLink.style.cursor = 'default';
	};
};

bb.dry.updateImageAdminButtons = function() {
	if (bb.ele.imageUploadButton) {
		bb.ele.imageUploadButton.disabled = bb.imageAdminBusy || !bb.sku.value;
	}
	if (bb.ele.imageDeleteButton) {
		bb.ele.imageDeleteButton.disabled = bb.imageAdminBusy || !(bb.sku.currentImage && bb.sku.currentImage.path);
	}
	if (bb.ele.imageZoomButton) {
		bb.ele.imageZoomButton.disabled = !(bb.sku.currentImage && bb.sku.currentImage.path);
	}
}

bb.dry.setImageToolsOpen = function(isOpen) {
	if (!bb.ele.imageToolsToggle || !bb.ele.imageToolActions) { return; }
	bb.ele.imageToolActions.hidden = !isOpen;
	bb.ele.imageToolsToggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
	bb.ele.imageToolsToggle.setAttribute('aria-label', isOpen ? 'Hide image controls' : 'Show image controls');
}

bb.dry.closeImageTools = function() {
	bb.dry.setImageToolsOpen(false);
}

bb.dry.openImageZoom = function() {
	if (!bb.ele.imageZoomModal || !bb.ele.imageZoomPreview || !bb.ele.mainHeaderImg || bb.ele.imageZoomButton.disabled) { return; }
	bb.imageZoomPreviousFocus = bb.ele.imageToolsToggle;
	bb.ele.imageZoomPreview.src = bb.ele.mainHeaderImg.currentSrc || bb.ele.mainHeaderImg.src;
	bb.ele.imageZoomPreview.alt = 'Enlarged image for ' + bb.sku.value;
	bb.ele.imageZoomModal.hidden = false;
	bb.ele.body.classList.add('imageZoomOpen');
	bb.dry.closeImageTools();
	if (bb.ele.imageZoomCloseButton) { bb.ele.imageZoomCloseButton.focus(); }
}

bb.dry.closeImageZoom = function() {
	if (!bb.ele.imageZoomModal || bb.ele.imageZoomModal.hidden) { return; }
	bb.ele.imageZoomModal.hidden = true;
	bb.ele.body.classList.remove('imageZoomOpen');
	bb.ele.imageZoomPreview.removeAttribute('src');
	if (bb.imageZoomPreviousFocus && typeof bb.imageZoomPreviousFocus.focus === 'function') {
		bb.imageZoomPreviousFocus.focus();
	}
	bb.imageZoomPreviousFocus = null;
}

bb.dry.setImageUploadStatus = function(message, busy) {
	bb.imageAdminBusy = !!busy;
	if (bb.imageUploadStatusTimer) {
		clearTimeout(bb.imageUploadStatusTimer);
		bb.imageUploadStatusTimer = null;
	}
	if (bb.ele.imageUploadStatus) {
		if (message) {
			bb.ele.imageUploadStatus.textContent = message;
			bb.ele.imageUploadStatus.style.display = "block";
		} else {
			bb.ele.imageUploadStatus.textContent = "";
			bb.ele.imageUploadStatus.style.display = "none";
		}
		bb.ele.imageUploadStatus.classList.toggle("busy", !!busy);
	}
	bb.dry.updateImageAdminButtons();
}

bb.dry.hideImageUploadStatusSoon = function() {
	if (!bb.ele.imageUploadStatus) { return; }
	if (bb.imageUploadStatusTimer) {
		clearTimeout(bb.imageUploadStatusTimer);
	}
	bb.imageUploadStatusTimer = setTimeout(function() {
		if (!bb.imageAdminBusy && bb.ele.imageUploadStatus) {
			bb.ele.imageUploadStatus.textContent = "";
			bb.ele.imageUploadStatus.style.display = "none";
			bb.ele.imageUploadStatus.classList.remove("busy");
		}
	}, 3500);
}

bb.dry.refreshSkuImages = function() {
	if (!bb.sku.value) { return; }
	bb.dry.loadSkuImages(bb.sku.value);
}

bb.dry.uploadSkuImage = function() {
	if (bb.imageAdminBusy) { return; }
	if (!bb.sku.value) {
		bb.dry.showQuickFeedback("Select a SKU before uploading an image.");
		return;
	}
	if (bb.ele.imageUploadInput) {
		bb.ele.imageUploadInput.value = "";
		bb.ele.imageUploadInput.click();
	}
}

bb.dry.handleImageUpload = function() {
	if (!bb.ele.imageUploadInput || !bb.ele.imageUploadInput.files || bb.ele.imageUploadInput.files.length < 1) {
		return;
	}

	const file = bb.ele.imageUploadInput.files[0];
	if (!file.type || file.type.indexOf('image/') !== 0) {
		bb.dry.setImageUploadStatus("Choose an image file.", false);
		bb.dry.hideImageUploadStatusSoon();
		return;
	}

	const targetSku = bb.sku.value.trim().toUpperCase();
	bb.dry.setImageUploadStatus("Adding image locally...", true);

	setTimeout(function() {
		if (bb.localSkuImages[targetSku] && bb.localSkuImages[targetSku].url) {
			URL.revokeObjectURL(bb.localSkuImages[targetSku].url);
		}
		bb.localSkuImages[targetSku] = { url: URL.createObjectURL(file), name: file.name };
		bb.dry.setImageUploadStatus("Image added for this browser session.", false);
		bb.dry.showQuickFeedback("Local image added. Nothing was uploaded.");
		if (bb.sku.value.trim().toUpperCase() === targetSku) {
			bb.dry.refreshSkuImages();
		}
		bb.dry.hideImageUploadStatusSoon();
	}, 500);
}

bb.dry.openDeleteImageModal = function() {
	if (!bb.sku.currentImage || !bb.sku.currentImage.path) {
		bb.dry.showQuickFeedback("Select an image before deleting.");
		return;
	}

	if (bb.ele.imageDeleteModalText) {
		bb.ele.imageDeleteModalText.textContent = "Remove " + bb.sku.currentImage.filename + " from SKU " + bb.sku.value + "? This demo change resets when the page reloads.";
	}
	if (bb.ele.imageDeleteConfirmButton) {
		bb.ele.imageDeleteConfirmButton.disabled = false;
	}
	if (bb.ele.imageDeleteModal) {
		bb.ele.imageDeleteModal.style.display = "flex";
	}
}

bb.dry.closeDeleteImageModal = function() {
	if (bb.ele.imageDeleteModal) {
		bb.ele.imageDeleteModal.style.display = "none";
	}
}

bb.dry.deleteSkuImage = function() {
	if (!bb.sku.currentImage || !bb.sku.currentImage.path) {
		return;
	}

	const currentImage = bb.sku.currentImage;
	const targetSku = bb.sku.value.trim().toUpperCase();
	bb.dry.setImageUploadStatus("Removing image locally...", true);
	bb.dry.closeDeleteImageModal();

	setTimeout(function() {
		if (currentImage.isLocal && bb.localSkuImages[targetSku]) {
			URL.revokeObjectURL(bb.localSkuImages[targetSku].url);
			delete bb.localSkuImages[targetSku];
		} else {
			bb.hiddenImagePaths[currentImage.path] = true;
		}
		bb.dry.setImageUploadStatus("Image removed for this browser session.", false);
		bb.dry.showQuickFeedback("Image removed locally.");
		if (bb.sku.value.trim().toUpperCase() === targetSku) {
			bb.dry.refreshSkuImages();
		}
		bb.dry.hideImageUploadStatusSoon();
	}, 400);
}

	//
	// create a sku card and add it to the tabs
	bb.dry.listBlockId = 0;
	bb.dry.createListBlock = function (lineItem, targetSKU, tabContentEle) {
		//
		bb.dry.listBlockId++; // increment the counter so we can always have a unique id
		//
		// get part description..
		var itemNameStr = "";
		for (i = 0; i < bb.ajax.inventory.length; i++) {
			if(bb.ajax.inventory[i].LocalSKU == targetSKU && itemNameStr == "") { // 
				itemNameStr = bb.ajax.inventory[i].ItemName; 
			}
		}
		//
		// create the assembly card and add it to the tab's content div
		var newBlock = document.createElement("div"); 
			newBlock.classList.add('card');
			newBlock.id = 'block'+ bb.dry.listBlockId;
			newBlock.setAttribute('role', 'button');
			newBlock.setAttribute('tabindex', '0');
			newBlock.setAttribute('aria-label', 'Open SKU ' + targetSKU);
			var newImg = document.createElement("img"); 
				newImg.classList.add('cardImg');
				newImg.src = bb.dry.imgBroken;
				newImg.alt = itemNameStr;
			newBlock.append(newImg)
			var newContainerDiv = document.createElement("div"); 
				newContainerDiv.classList.add('cardContent');
				var newSkuDiv = document.createElement("div");
					newSkuDiv.classList.add('cardSku');
					newSkuDiv.innerHTML = targetSKU;
				newContainerDiv.append(newSkuDiv)
				var newNameDiv = document.createElement("div");
					newNameDiv.classList.add('cardName');
					newNameDiv.innerHTML = itemNameStr;
				newContainerDiv.append(newNameDiv)
				var newQtyDiv = document.createElement("div");
					newQtyDiv.classList.add('cardQty');
					if(lineItem.Quantity > 1) { newQtyDiv.classList.add('moreThanOneQty'); }
					newQtyDiv.innerHTML = "Quantity: " + lineItem.Quantity;
				newContainerDiv.append(newQtyDiv)
			newBlock.append(newContainerDiv)
		tabContentEle.append(newBlock)
		//
		// update the card image
		// Example snippet clearly showing correct definition
		var cardContent = document.getElementById('block' + bb.dry.listBlockId);
		var imgEle = cardContent.getElementsByClassName("cardImg")[0];

		bb.dry.updateCardImageSrc(imgEle, targetSKU);
		
		//
		// Treat the entire card, including its image, as one SKU action.
		function openCardSku(evn) {
			if (evn.type === 'keydown' && evn.key !== 'Enter' && evn.key !== ' ') { return; }
			if (evn.type === 'keydown') { evn.preventDefault(); }
			bb.dry.populateSelectBox({'optArr':bb.ajax.inventorySkus}); // reset select box to house all skus again
			bb.ele.searchInput.value = '';
			bb.ele.tab1.button.click(); // click on the default tab (Assembly)
			var clickedSku = cardContent.getElementsByClassName("cardSku")[0].innerHTML;
			bb.ele.skuSelectBox.value = clickedSku.toUpperCase();
			bb.ele.skuSelectBox.dispatchEvent(new Event('change'));
		}
		newBlock.addEventListener("click", openCardSku, false);
		newBlock.addEventListener("keydown", openCardSku, false);
	}
		
		
	bb.dry.updateEle = function(targetEle, value) {
		if (value == "") {
			targetEle.innerHTML = "~"
		} else {
			targetEle.innerHTML = value;
		}
	}

	
	
	//
	// load keyboard event handler
	// users type or use a hand scanner to enter SKUs into the search box
	// when they hit enter, it tries to select the SKU in the multiselect box
	document.addEventListener('keydown', function(event) {
		if (bb.ele.imageZoomModal && !bb.ele.imageZoomModal.hidden) { return; }
		if (bb.ele.criticalNotesText == document.activeElement) { return; }

		const arrowKeys = ['ArrowUp', 'ArrowDown']
		if (arrowKeys.indexOf(event.key) >= 0) {
			if (bb.ele.skuSelectBox !== document.activeElement) {
				bb.ele.skuSelectBox.focus();
				return;
			}
		}
		
		const ignoreKeys = ['Shift', 'Alt', 'Tab', 'CapsLock', 'OS', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown']
		if (ignoreKeys.indexOf(event.key) >= 0) {return;} // if the key pressed is in the array, skip the rest of function


		if (bb.ele.searchInput !== document.activeElement) {
			// if the input isn't active, clear it and make it active so user can start typing in the sku
			bb.ele.searchInput.value = "";
			bb.ele.searchInput.focus();
		} else if (bb.ele.searchInput == document.activeElement) {
			if (event.key == "Escape") {
				bb.ele.searchInput.blur();
				bb.ele.searchInput.value = "";
				return;
			}
			if (event.key == "Enter") {
				bb.ele.skuSelectBox.value = bb.ele.searchInput.value.toUpperCase();
				bb.ele.skuSelectBox.dispatchEvent(new Event('change'));
				bb.ele.searchInput.blur();
				return;
			}
		}
		//console.log("event.key: " + event.key + " bb.ele.searchInput.value: " + bb.ele.searchInput.value )
	}, false);
	
	
	

//
// AJAX FUNCTIONS - get files off the server and turn into variables
//
	//
	// Get file from the server and then calls ajaxResponded() with response
	bb.ajax.requestFile = function (file) {
		//
		// get the file
		var xhr = new XMLHttpRequest();
		xhr.onreadystatechange = function() {
			if (this.readyState == 4 && this.status == 200) {
				if (file.type == 'document') { file.data = this.responseXML }
				if (file.type == 'str') { file.data = this.responseText }
				bb.ajax.promises--; // this is where the promises counter gets decremented to track number of successful downloads
				bb.ajax.responded(file);
			}
		}
		if (file.type == 'document') { xhr.responseType = 'document'; }
		xhr.open("GET", file.path + "?cache=" + (Math.random()*1000000), true);
		xhr.send();	
	}
	bb.ajax.responded = function (file) {
		console.log(file.path+' downloaded... promises left: '+bb.ajax.promises)
		bb.ajax.fileData[file.tag] = file.data; // save the file contents to bb.buildbooks.'tag'
		if ( bb.ajax.promises == 0) { // only fire after the last file has been retrieved
			bb.ajax.finished();
		}
	}	
	// ai
bb.ajax.finished = function () {
  console.log('Ajax files finished loading');

  bb.ajax.criticalNote = bb.dry.tsvStrToObj(bb.ajax.fileData['criticalNoteCSV']);
  bb.ajax.assemblies = bb.dry.tsvStrToObj(bb.ajax.fileData['assembliesCSV']);
  bb.ajax.inventory = bb.dry.tsvStrToObj(bb.ajax.fileData['inventoryCSV']);

  bb.ajax.inventorySkus = bb.dry.getKeyArr(bb.ajax.inventory, "LocalSKU");

  bb.dry.populateSelectBox({'optArr':bb.ajax.inventorySkus});
  
  bb.ele.searchInput.value = bb.urlQuerySearch || ''; 
  bb.dry.updateLinks();
  bb.dry.searchInputChange();

  if(bb.urlQueryItem){
    bb.ele.skuSelectBox.value = bb.urlQueryItem.toUpperCase();
    bb.ele.skuSelectBox.dispatchEvent(new Event('change'));
  }

};

	
//
// HTML ELEMENT ALTERATION FUNCTIONS
//
	//
	// helper to fill the multi select box with the provided list of skus
	bb.dry.populateSelectBox = function (params) {
		// clear the pane of existing options
		bb.ele.skuSelectBox.innerHTML = "";
		// Populate the SKU selection pane
		var frag = document.createDocumentFragment();
		if (bb.dry.isCompactSkuSelect()) {
			var placeholderOpt = document.createElement('option');
			placeholderOpt.value = "";
			placeholderOpt.innerHTML = "Select SKU...";
			placeholderOpt.disabled = true;
			placeholderOpt.selected = true;
			frag.appendChild(placeholderOpt);
		}
		for (var i = 0; i<params.optArr.length; i++){
			var opt = document.createElement('option');
			opt.value = params.optArr[i];
			opt.innerHTML = params.optArr[i];
			if(opt.value == "undefined") {continue;}
			frag.appendChild(opt);
		}
		bb.ele.skuSelectBox.appendChild(frag);
	}
	bb.dry.isCompactSkuSelect = function () {
		return window.matchMedia ? window.matchMedia("(max-width: 720px)").matches : window.innerWidth <= 720;
	}
	bb.dry.syncSkuSelectSize = function () {
		if (!bb.ele.skuSelectBox) {
			return;
		}

		bb.ele.skuSelectBox.size = bb.dry.isCompactSkuSelect() ? 1 : 15;
	}
	//
	// ai click to toggle sidebar slideout
	bb.dry.hideSidebar = function () {
		var sidebarWidth = Number.parseInt(bb.ele.sidebar.style.width || window.getComputedStyle(bb.ele.sidebar).width, 10);
		if (sidebarWidth <= 20) {
			bb.ele.sidebar.style.width = "220px";
			bb.ele.sidebar.style.height = "600px";
			bb.ele.main.style.left = "250px";
			bb.ele.buttonHideSidebar.classList.add("buttonHideSidebarTransition");
		} else {
			bb.ele.sidebar.style.width = "10px";
			bb.ele.sidebar.style.height = "56px";
			bb.ele.main.style.left = "40px";
			bb.ele.buttonHideSidebar.classList.remove("buttonHideSidebarTransition");
		}
	}
	//
	// click to show bom underneath error message when there are overlapping boms
	bb.dry.showErrorBom = function () {
		bb.ele.tab1.content.style.display = "block";
	}
	
	
//
// HTML ELEMENT ALTERATION FUNCTIONS
//
	bb.dry.configureDataSources = function () {
		bb.ajax.path1 = 'database/buildbooks-bom.tsv';
		bb.ajax.path2 = 'database/buildbooks-inventory.tsv';
		bb.ajax.path3 = 'database/Buildbooks_CRITICAL_NOTES.tsv';
	}
	
	//
	// Update the share URL to match the current Buildbooks state.
	bb.dry.updateLinks = function () {
		var newLink = window.location.origin + '/apps/buildbooks/bb?item=' + encodeURIComponent(bb.sku.value) + '&search=' + encodeURIComponent(bb.ele.searchInput.value) + '&tab=' + document.querySelector(".tablinks.active").id.slice(-1);
		//
		// update the sharelink button url to the current state of the app
		document.getElementById('shareLink').setAttribute('data-clipboard-text', newLink);
		
			
	}
	
//
// DRY FUNCTIONS - helpers that try not to have application-specific references in them
//

//
// To get he query string out of the url
	bb.dry.getUrlQueryStr = function (name, url = window.location.href) {
		name = name.replace(/[\[\]]/g, '\\$&');
		var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
			results = regex.exec(url);
		if (!results) return null;
		if (!results[2]) return '';
		return decodeURIComponent(results[2].replace(/\+/g, ' '));
	}
	
	//
	// When a user types something into the search box, constrain the skus displayed in the select box to only those that contain the search term
	bb.dry.searchInputChange = function () {
	  var filteredPaneList = bb.ajax.inventorySkus.filter(sku => 
		sku.toLowerCase().includes(bb.ele.searchInput.value.toLowerCase())
	  );

	  bb.dry.populateSelectBox({'optArr':filteredPaneList});
	  bb.dry.updateLinks();

	  if (filteredPaneList.length === 0) {
		bb.ele.skuSelectBox.innerHTML = '<option disabled>Choose a Brand Filter</option>';
	  }
	}

	//
	// helper to make click listeners one liners
	bb.dry.addClickListener = function (params) {
		params.ele.addEventListener("click", function() {
			if( params.group.length > 0 ) {
				bb[params.group][params.callback](params); // for when a group other than "dry" is expected
			} else {
				bb.dry[params.callback](params); // for singles like the buttonHideSidebar
			}
		}, false);
	}
	
	//
	// display a tabs contents when its clicked on
	bb.dry.showTab = function (evt, tabEle) {
		// Declare all variables
		var i, tabcontent, tablinks;
		//
		// Get all elements with class="tabcontent" and hide them
		tabcontent = document.getElementsByClassName("tabcontent");
		for (i = 0; i < tabcontent.length; i++) {
			tabcontent[i].style.display = "none";
		}
		//
		// Get all elements with class="tablinks" and remove the class "active"
		tablinks = document.getElementsByClassName("tablinks");
		for (i = 0; i < tablinks.length; i++) {
			tablinks[i].className = tablinks[i].className.replace(" active", "");
		}
		//
		// Show the current tab, and add an "active" class to the button that opened the tab
		document.getElementById(tabEle).style.display = "block";
		evt.currentTarget.className += " active";
	} 

	//
	// create array of unique keys out of an object
	bb.dry.getKeyArr = function (obj, keyname){
		var result = [];
		// make an array of skus from the inventory table
		for (var i = 0; i<obj.length; i++){
			result.push(obj[i][keyname]);
		}
		// strip blanks and alphabetize	... use bb helper to return only unique values
		return bb.dry.uniquify(result.filter(String).sort());
	}
	//
	// Return a unique array, stripped of repeating keys
	bb.dry.uniquify = function (a) {
		var seen = {};
		var out = [];
		var len = a.length;
		var j = 0;
		for(var i = 0; i < len; i++) {
			 var item = a[i];
			 if(seen[item] !== 1) {
				   seen[item] = 1;
				   out[j++] = item;
			 }
		}
		return out;
	} 
	
	
	// Updated JS function to remove encapsulating quotes
	bb.dry.tsvStrToObj = function (tsv){
		var lines = tsv.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
		var result = [];

		// Remove encapsulating quotes from headers, if present
		var headers = lines[0];
		if (headers.startsWith('"') && headers.endsWith('"')) {
			headers = headers.slice(1, -1);
		}
		headers = headers.split("\t");
		
		for(var i = 1; i < lines.length; i++){
			var obj = {};

			// Remove encapsulating quotes, if present
			var line = lines[i];
			if (line.startsWith('"') && line.endsWith('"')) {
				line = line.slice(1, -1);
			}

			var currentline = line.split("\t");
			for(var j = 0; j < headers.length; j++){
				obj[headers[j]] = currentline[j];
			}
			result.push(obj);
		}
		return result; // JavaScript object
	}

	bb.dry.getInventoryCoo = function (row) {
		if (!row) { return ""; }
		if (row.COO != undefined) { return String(row.COO).trim(); }
		return "";
	}
	//
	//
bb.dry.updateImageSrc = function (imgEle, sku) { 
    const paths = [
        bb.dry.versionedImageUrl(`images/custom/${encodeURIComponent(sku.trim()).toLowerCase()}.jpg`),
        bb.dry.versionedImageUrl(`images/ecom/${encodeURIComponent(sku.trim()).toLowerCase()}.jpg`),
        bb.dry.imgBroken
    ];

    let currentPathIndex = 0;

    imgEle.onerror = function () {
        currentPathIndex++;
        if (currentPathIndex < paths.length) {
            imgEle.src = paths[currentPathIndex];
        } else {
            imgEle.classList.add(bb.dry.classBroken);
            imgEle.onerror = null;  // Safely remove error handler
        }
    };

    imgEle.src = paths[currentPathIndex];  // Initial load
};


		
	bb.dry.GetIEVersion = function () {
	  var sAgent = window.navigator.userAgent;
	  var Idx = sAgent.indexOf("MSIE");
	  var EdgeID = sAgent.indexOf("Edge");
	  
	  
	  // If IE, return version number.
	  if (Idx > 0) 
		return parseInt(sAgent.substring(Idx+ 5, sAgent.indexOf(".", Idx)));

	  // If IE 11 then look for Updated user agent string.
	  else if (!!navigator.userAgent.match(/Trident\/7\./)) 
		return 11;

	  else if (EdgeID > 0)
		  return parseInt(sAgent.substring(EdgeID+ 5, sAgent.indexOf(".", EdgeID)));
	
	  else
		return 0; //It is not IE
	}
	
	
//
// HIDDEN TAB
//

	bb.dry.showPrintLabelContainer = function () {
	  if (bb.ele.printContainer.style.display === "none") {
		bb.ele.printContainer.style.display = "block";
	  } else {
		bb.ele.printContainer.style.display = "none";
	  }
	} 

	
//
// UPDATE BARCODE LABEL 
//
	bb.dry.makeLabelPreview = function () {
		//console.log("make preview")
		for (var item of document.getElementsByClassName('labelSku')) { // update SKUs on the preview labels
			item.innerHTML = bb.ele.sku.innerHTML;
		}
		
		for (var item of document.getElementsByClassName('labelDesc')) { //update descriptions
			item.innerHTML = bb.ele.name.innerHTML;
		}
		for (var item of document.getElementsByClassName('labelDate')) { //update descriptions
			item.innerHTML = new Date().toDateString();
		}
		for (var item of document.getElementsByClassName('labelDatecode')) { // year and month datecode like:  0918
			item.innerHTML = ("0" + (new Date().getMonth() + 1)).slice(-2) + new Date().getFullYear().toString().substr(2,2);
		}	

		var countryOfOrigin = document.querySelector("#barcodeCountryOfOrigin");
		if (countryOfOrigin) {
			var coo = bb.sku.coo ? String(bb.sku.coo).trim() : "";
			if (coo.length > 0) {
				countryOfOrigin.textContent = "COO: " + coo;
				countryOfOrigin.style.display = 'block';
			} else {
				countryOfOrigin.textContent = "";
				countryOfOrigin.style.display = 'none';
			}
		}
		
		//	console.log(bb.ele.upc.innerHTML);
		if ( bb.ele.upc.innerHTML.length < 3) {
			// no upc, so show logo svg instead
			document.querySelector("#svglogo").style.display = 'block';
			document.querySelector("#plabelUpc").style.display = 'none';
			//console.log("length < 3");
		} else {
			//console.log("length NOT < 3");
			// if the upc code exists, update the label preview
			JsBarcode('.labelUpc', bb.ele.upc.innerHTML, {format:'upc', value:bb.ele.upc, 'width':2, height:'90', 'displayValue':true, 'background':'', font:'Miriam Libre'}); // update 3of9 bar codes
			document.querySelector("#svglogo").style.display = 'none';
		}
		
		JsBarcode('.label3of9', bb.ele.sku.innerHTML, {format:'code39', value:bb.ele.sku.innerHTML, 'width':1, 'displayValue':false}); // update UPC bar codes

	}
	
//
// AI: Avoid rapid-fire DOM updates for smoother typing and improved performance.Add a simple debounce wrapper:
//	
	bb.dry.debounce = function(func, delay = 1) {
	  let debounceTimer;
	  return function() {
		const context = this, args = arguments;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => func.apply(context, args), delay);
	  };
	}

	bb.dry.updateCardImageSrc = function(imgEle, sku) {
		const paths = [
			bb.dry.versionedImageUrl(`images/custom/${encodeURIComponent(sku.trim()).toLowerCase()}.jpg`),
			bb.dry.versionedImageUrl(`images/ecom/${encodeURIComponent(sku.trim()).toLowerCase()}.jpg`),
			bb.dry.imgBroken
		];
		let currentPathIndex = 0;

		imgEle.onerror = function() {
			currentPathIndex++;
			if (currentPathIndex < paths.length) {
				imgEle.src = paths[currentPathIndex];
			} else {
				imgEle.onerror = null;
			}
		};

		imgEle.src = paths[currentPathIndex];
	};

