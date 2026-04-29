let scene, camera, renderer, teapot;
let mouseX = 0, mouseY = 0;
let targetRotationX = 0, targetRotationY = 0;

function init() {
    const container = document.getElementById('canvas-container');
    
    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x667eea);
    
    // Camera setup
    camera = new THREE.PerspectiveCamera(
        75,
        container.clientWidth / container.clientHeight,
        0.1,
        1000
    );
    camera.position.z = 150;
    
    // Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const pointLight = new THREE.PointLight(0xffffff, 0.8);
    pointLight.position.set(100, 100, 100);
    scene.add(pointLight);
    
    const pointLight2 = new THREE.PointLight(0xff69b4, 0.4);
    pointLight2.position.set(-100, -100, 50);
    scene.add(pointLight2);
    
    // Load teapot STL
    loadTeapot();
    
    // Mouse tracking
    document.addEventListener('mousemove', onMouseMove);
    window.addEventListener('resize', onWindowResize);
    
    // Start animation loop
    animate();
}

function loadTeapot() {
    const loader = new THREE.STLLoader();
    loader.load('teapot.stl', function (geometry) {
        geometry.center();
        geometry.computeVertexNormals();
        
        const material = new THREE.MeshPhongMaterial({
            color: 0xff6b6b,
            shininess: 100,
            emissive: 0x220000,
            side: THREE.DoubleSide
        });
        
        teapot = new THREE.Mesh(geometry, material);
        scene.add(teapot);
    }, undefined, function (error) {
        console.error('Error loading teapot.stl:', error, 'I guess the sever is too much of a teapot!');
    });
}

function onMouseMove(event) {
    // Calculate normalized mouse position relative to viewport
    const rect = document.getElementById('canvas-container').getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    
    // Convert to rotation angles
    targetRotationY = (x - 0.5) * Math.PI * 2;
    targetRotationX = (y - 0.5) * Math.PI * 1.5;
}

function animate() {
    requestAnimationFrame(animate);
    
    // Smooth rotation towards target
    if (teapot) {
        teapot.rotation.x += (targetRotationX - teapot.rotation.x) * 0.05;
        teapot.rotation.y += (targetRotationY - teapot.rotation.y) * 0.05;
    }
    
    renderer.render(scene, camera);
}

function onWindowResize() {
    const container = document.getElementById('canvas-container');
    if (!container) return;
    
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);