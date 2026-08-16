
   
	//
	// This file adds JS to the home page. 
	// It was added 3/31/23 in response to adding the accordion with various apps to the front page. -BT
	//
	
	//
	// kicks off as soon as possible when everything is loaded
	window.addEventListener('DOMContentLoaded', function() {
		console.log("bb DOMContentLoaded!");
				//
		// wire up the accordion
		var acc = document.getElementsByClassName("accordion");
		for (var i = 0; i < acc.length; i++) {
			
		  acc[i].addEventListener("click", function() {
			/* Toggle between adding and removing the "active" class,
			to highlight the button that controls the panel */
			
			this.classList.toggle("active");
			this.nextElementSibling.classList.toggle("active");
		  });
		} 
		// accordion end
	})
