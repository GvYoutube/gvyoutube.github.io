READ THIS!!!: If you have flash games (files with .swf as their filetype) please put it in a folder with the game name aswell as a index file with the following code:
```
<!DOCTYPE html>
<html>
<head>
	<title>Student and Parent Sign In</title>
	<meta charset="utf-8">
	<link rel="stylesheet" href="style.css" type="text/css">
	<link rel="shortcut icon" type="image/x-icon" href="https://gvyoutube.codeberg.page/gaming/favicon.png">
	<script src="https://unpkg.com/@ruffle-rs/ruffle"></script>
	<style>
		html, body {
			margin: 0;
			padding: 0;
			height: 100%;
			width: 100%;
			overflow: hidden;
		}
		#center {
			display: flex;
			justify-content: center;
			align-items: center;
			height: 100%;
			width: 100%;
			background-color: black; /* Optional background color for fullscreen */
		}
	</style>
</head>
<body>
<div id="center">
	<script>
window.RufflePlayer = window.RufflePlayer || {};
window.RufflePlayer.config = {
    "allowScriptAccess": true,
    "base": "https://gvyoutube.codeberg.page/gaming/internal/games/[foldernamehere]",
    "autoplay": "auto",	
};

window.addEventListener("load", () => {
    const ruffle = window.RufflePlayer.newest();
    const player = ruffle.createPlayer();
    const container = document.getElementById("center");
    container.appendChild(player);
    player.style.width = "100%";
    player.style.height = "100%"; // Ensures fullscreen
    player.load("yourgame.swf");
});
	</script>
</div>
</body>
</html>
```