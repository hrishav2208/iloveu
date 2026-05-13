import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { HandTracker } from './HandTracker.js';

class MemoryTheater {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.FogExp2(0x050A1F, 0.05); // Adds depth to the scene
        this.isPaused = false;
        
        // Setup Camera
        this.camera = new THREE.PerspectiveCamera(
            60, 
            window.innerWidth / window.innerHeight, 
            0.1, 
            1000
        );
        this.camera.position.set(0, 0, 8);

        // Setup Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        // Setup Post-Processing (Bloom for the PRO Neon Look)
        const renderScene = new RenderPass(this.scene, this.camera);
        const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        bloomPass.threshold = 0.2;
        bloomPass.strength = 1.2;
        bloomPass.radius = 0.5;

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(renderScene);
        this.composer.addPass(bloomPass);

        this.clock = new THREE.Clock();
        this.targetRotationY = 0;
        this.targetRotationX = 0;

        this.memoryMeshes = [];
        this.hoveredMesh = null;
        this.focusedMesh = null;
        this.magicWandActive = false;
        this.isExploding = false;
        this.meshVelocities = [];
        this.explosionTimer = null;
        this.hasUserPhotos = false;
        this.lastFocusedMesh = null;
        
        this.lastSmileTime = 0;
        this.compliments = [
            "You have a cute smile! 😊",
            "Really in love with your smile! 🥰",
            "Your smile lights up the room! ✨",
            "Keep smiling, it suits you! 💖",
            "That smile is everything! 😍"
        ];

        this.initFireworks();

        this.initParticles();
        this.initMemories();
        this.initHandMarker();
        
        // Handle window resize
        window.addEventListener('resize', this.onWindowResize.bind(this));

        // Start render loop
        this.animate();
        
        this.uiSetup();
    }

    initParticles() {
        this.particleCount = 5000; // Increased for a pro look
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(this.particleCount * 3);
        const colors = new Float32Array(this.particleCount * 3);
        this.velocities = new Float32Array(this.particleCount * 3);

        const colorPink = new THREE.Color('#FFD1DC');
        const colorBlue = new THREE.Color('#4169E1'); // Brighter royal blue

        for (let i = 0; i < this.particleCount; i++) {
            // Distribute in a massive cylinder around the user
            const radius = 5 + Math.random() * 20;
            const theta = Math.random() * Math.PI * 2;
            const y = (Math.random() - 0.5) * 40;

            positions[i * 3] = Math.cos(theta) * radius;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = Math.sin(theta) * radius;

            this.velocities[i * 3] = 0;
            this.velocities[i * 3 + 1] = 0;
            this.velocities[i * 3 + 2] = 0;

            const mixedColor = Math.random() > 0.4 ? colorPink : colorBlue;
            // Introduce some pure white stars
            if(Math.random() > 0.95) mixedColor.setHex(0xFFFFFF);
            
            colors[i * 3] = mixedColor.r;
            colors[i * 3 + 1] = mixedColor.g;
            colors[i * 3 + 2] = mixedColor.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const context = canvas.getContext('2d');
        const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(0.2, 'rgba(255,255,255,0.8)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 32, 32);
        const texture = new THREE.CanvasTexture(canvas);

        const material = new THREE.PointsMaterial({
            size: 0.2,
            vertexColors: true,
            map: texture,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.particles = new THREE.Points(geometry, material);
        this.scene.add(this.particles);
    }

    initMemories() {
        this.carouselGroup = new THREE.Group();
        this.scene.add(this.carouselGroup);

        const textureLoader = new THREE.TextureLoader();
        textureLoader.setCrossOrigin("anonymous");
        const numPhotos = 20; 

        for (let i = 0; i < numPhotos; i++) {
            const texture = textureLoader.load(`https://picsum.photos/seed/${i + 40}/400/600`);
            this.addPhotoToGlobe(texture, i);
        }
        this.recalculateGlobe();
    }

    addPhotoToGlobe(texture, index) {
        const vertexShader = `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `;
        
        const fragmentShader = `
            uniform sampler2D map;
            uniform float time;
            uniform vec3 glowColor;
            uniform float intensity;
            varying vec2 vUv;

            void main() {
                float scanline = sin(vUv.y * 50.0 - time * 2.0) * 0.02 * intensity;
                vec2 distortedUv = vec2(vUv.x + scanline, vUv.y);
                vec4 texColor = texture2D(map, distortedUv);
                vec3 finalColor = mix(texColor.rgb, glowColor, 0.15 * intensity);
                float flicker = sin(time * 15.0) * 0.05 + 0.95;
                gl_FragColor = vec4(finalColor * flicker, texColor.a * (0.8 + 0.2 * intensity));
            }
        `;

        const isPink = index % 2 === 0;
        const glowColor = isPink ? new THREE.Color(0xFFD1DC) : new THREE.Color(0x4169E1);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                map: { value: texture },
                time: { value: 0 },
                glowColor: { value: glowColor },
                intensity: { value: 0.5 }
            },
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            side: THREE.DoubleSide,
            transparent: true
        });

        const geometry = new THREE.PlaneGeometry(1.5, 2.25, 32, 32); 
        const mesh = new THREE.Mesh(geometry, material);

        mesh.userData = {
            targetScale: 1.0,
            origPos: new THREE.Vector3(),
            origQuat: new THREE.Quaternion(),
            caption: "", // Stores the user's note for this specific photo
            isWandTarget: Math.random() < 0.5,
            wandOffset: new THREE.Vector3(
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.5
            )
        };

        this.memoryMeshes.push(mesh);
        this.carouselGroup.add(mesh);
    }

    recalculateGlobe() {
        const numPhotos = this.memoryMeshes.length;
        // Dynamically expand the globe if they add a lot of photos
        const radius = Math.max(6, 4 + numPhotos * 0.1); 

        for (let i = 0; i < numPhotos; i++) {
            const mesh = this.memoryMeshes[i];
            const phi = Math.acos(1 - 2 * (i + 0.5) / numPhotos);
            const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5);

            mesh.userData.origPos.x = radius * Math.cos(theta) * Math.sin(phi);
            mesh.userData.origPos.y = radius * Math.cos(phi);
            mesh.userData.origPos.z = radius * Math.sin(theta) * Math.sin(phi);

            mesh.position.copy(mesh.userData.origPos);
            mesh.lookAt(0, 0, 0);
            mesh.userData.origQuat.copy(mesh.quaternion);
        }
    }

    initHandMarker() {
        // More pro-looking hand marker (Crystal/Diamond shape)
        const geometry = new THREE.OctahedronGeometry(0.3, 0);
        const material = new THREE.MeshBasicMaterial({ 
            color: 0xFFFFFF, 
            wireframe: true,
            transparent: true,
            opacity: 0.8
        });
        this.handMarker = new THREE.Mesh(geometry, material);
        this.handMarker.visible = false;
        
        this.handMarker2 = new THREE.Mesh(geometry, material.clone());
        this.handMarker2.visible = false;
        
        // Intense point lights to trigger the Bloom effect
        const light = new THREE.PointLight(0xFFD1DC, 5, 10);
        this.handMarker.add(light);
        
        const light2 = new THREE.PointLight(0x4169E1, 5, 10);
        this.handMarker2.add(light2);
        
        this.scene.add(this.handMarker);
        this.scene.add(this.handMarker2);
    }

    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setSize(window.innerWidth, window.innerHeight);
    }

    animate() {
        requestAnimationFrame(this.animate.bind(this));
        
        const delta = this.clock.getDelta();
        const elapsedTime = this.clock.getElapsedTime();

        // Animate particles
        if (this.particles && !this.isPaused) {
            this.particles.rotation.y = elapsedTime * 0.02;

            const positions = this.particles.geometry.attributes.position.array;
            let needsUpdate = false;
            for (let i = 0; i < this.particleCount; i++) {
                if (Math.abs(this.velocities[i*3]) > 0.001) {
                    positions[i*3] += this.velocities[i*3];
                    positions[i*3+1] += this.velocities[i*3+1];
                    positions[i*3+2] += this.velocities[i*3+2];
                    
                    this.velocities[i*3] *= 0.95;
                    this.velocities[i*3+1] *= 0.95;
                    this.velocities[i*3+2] *= 0.95;
                    needsUpdate = true;
                }
            }
            if (needsUpdate) {
                this.particles.geometry.attributes.position.needsUpdate = true;
            }
        }

        // Explosion: push photo meshes outward then let them drift
        if (this.isExploding && this.meshVelocities.length) {
            this.memoryMeshes.forEach((mesh, i) => {
                const v = this.meshVelocities[i];
                if (v) {
                    mesh.position.add(v);
                    v.multiplyScalar(0.97); // drag
                    mesh.rotation.x += 0.04;
                    mesh.rotation.y += 0.03;
                    if (mesh.material.uniforms) mesh.material.uniforms.intensity.value = 1.8;
                }
            });
        }

        // Smooth carousel rotation on both axes (only if not focused and not exploding)
        if (this.carouselGroup && !this.focusedMesh && !this.isExploding) {
            this.carouselGroup.rotation.y += (this.targetRotationY - this.carouselGroup.rotation.y) * 0.1;
            this.carouselGroup.rotation.x += (this.targetRotationX - this.carouselGroup.rotation.x) * 0.1;

            // Smoothly return globe to normal size if magic wand is released
            if (!this.magicWandActive) {
                this.carouselGroup.scale.lerp(new THREE.Vector3(1, 1, 1), 0.05);
            }
        }

        // Animate markers rotating themselves
        this.handMarker.rotation.y += 0.05;
        this.handMarker.rotation.x += 0.02;
        this.handMarker2.rotation.y += 0.05;
        this.handMarker2.rotation.x += 0.02;

        // Set Shader time
        this.memoryMeshes.forEach(mesh => {
            if (mesh.material.uniforms) {
                mesh.material.uniforms.time.value = elapsedTime;
            }
        });

        if (!this.focusedMesh) {
            // Normal Hover Logic
            let closestMesh = null;
            let closestDist = 4.0;

            if (this.handMarker.visible && !this.magicWandActive) {
                const handWorldPos = new THREE.Vector3();
                this.handMarker.getWorldPosition(handWorldPos);

                this.memoryMeshes.forEach(mesh => {
                    const meshWorldPos = new THREE.Vector3();
                    mesh.getWorldPosition(meshWorldPos);

                    if (meshWorldPos.z > 2) {
                        const dist = Math.sqrt(
                            Math.pow(handWorldPos.x - meshWorldPos.x, 2) +
                            Math.pow(handWorldPos.y - meshWorldPos.y, 2)
                        );
                        if (dist < closestDist) {
                            closestDist = dist;
                            closestMesh = mesh;
                        }
                    }
                });
            }
            this.hoveredMesh = closestMesh;

            this.memoryMeshes.forEach(mesh => {
                if (mesh === this.hoveredMesh) {
                    mesh.userData.targetScale = 1.3;
                    mesh.material.uniforms.intensity.value = 1.5;
                } else {
                    mesh.userData.targetScale = 1.0;
                    mesh.material.uniforms.intensity.value = 0.5;
                }
                const scaleOffset = (mesh.userData.targetScale - mesh.scale.x) * 0.1;
                mesh.scale.set(
                    mesh.scale.x + scaleOffset,
                    mesh.scale.y + scaleOffset,
                    mesh.scale.z + scaleOffset
                );
                mesh.position.lerp(mesh.userData.origPos, 0.1);
                mesh.quaternion.slerp(mesh.userData.origQuat, 0.1);
            });
        } else {
            // FOCUS MODE
            // Dim others slightly, return them to normal
            this.memoryMeshes.forEach(mesh => {
                if (mesh !== this.focusedMesh) {
                    mesh.userData.targetScale = 1.0;
                    mesh.material.uniforms.intensity.value = 0.2; // dim others
                    const scaleOffset = (mesh.userData.targetScale - mesh.scale.x) * 0.1;
                    mesh.scale.set(mesh.scale.x + scaleOffset, mesh.scale.y + scaleOffset, mesh.scale.z + scaleOffset);
                    mesh.position.lerp(mesh.userData.origPos, 0.1);
                    mesh.quaternion.slerp(mesh.userData.origQuat, 0.1);
                }
            });

            // Bring focused mesh to camera — directly in front
            const worldTargetPos = this.camera.position.clone().add(new THREE.Vector3(0, 0, -2.5));
            const localTargetPos = this.carouselGroup.worldToLocal(worldTargetPos);
            this.focusedMesh.position.lerp(localTargetPos, 0.1);

            // Make it face camera squarely
            const currentQuat = this.focusedMesh.quaternion.clone();
            this.focusedMesh.lookAt(this.carouselGroup.worldToLocal(this.camera.position.clone()));
            const targetQuat = this.focusedMesh.quaternion.clone();
            this.focusedMesh.quaternion.copy(currentQuat);
            this.focusedMesh.quaternion.slerp(targetQuat, 0.1);

            // Scale up
            const scaleOffset = (2.4 - this.focusedMesh.scale.x) * 0.1;
            this.focusedMesh.scale.set(
                this.focusedMesh.scale.x + scaleOffset,
                this.focusedMesh.scale.y + scaleOffset,
                this.focusedMesh.scale.z + scaleOffset
            );

            // ZERO intensity = crystal clear, no hologram noise
            this.focusedMesh.material.uniforms.intensity.value = 0.0; 
        }

        // Show / Hide Caption Panel on state change
        if (this.focusedMesh !== this.lastFocusedMesh) {
            const captionPanel = document.getElementById('caption-panel');
            const captionInput = document.getElementById('caption-input');
            
            if (this.focusedMesh) {
                // Image just became focused
                if (captionPanel) captionPanel.style.display = 'block';
                if (captionInput) {
                    captionInput.value = this.focusedMesh.userData.caption || "";
                }
            } else {
                // Image just got released
                if (captionPanel) captionPanel.style.display = 'none';
            }
            this.lastFocusedMesh = this.focusedMesh;
        }

        // Use Composer for Bloom instead of standard renderer
        this.composer.render();
    }

    showCompliment() {
        const overlay = document.getElementById('compliment-overlay');
        const text = document.getElementById('compliment-text');
        if (!overlay || !text) return;
        
        const randomCompliment = this.compliments[Math.floor(Math.random() * this.compliments.length)];
        text.innerText = randomCompliment;
        
        overlay.style.display = 'block';
        overlay.style.animation = 'none'; // Reset animation
        void overlay.offsetWidth; // Trigger reflow
        overlay.style.animation = 'popInCompliment 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards';
        
        setTimeout(() => {
            overlay.style.animation = 'fadeOutCompliment 0.8s ease forwards';
            setTimeout(() => {
                overlay.style.display = 'none';
            }, 800);
        }, 3000); // Show for 3 seconds
    }

    handleGesture(data) {
        if (!data || data.type === 'none') {
            this.handMarker.visible = false;
            this.handMarker2.visible = false;
            this._updateGestureLabel('—');
            return;
        }

        this._updateGestureLabel(data.type);
        const ltEl = document.getElementById('loading-text');
        if (ltEl) ltEl.innerText = "Gesture: " + data.type.toUpperCase();

        // Ensure target X is inverted correctly for mirroring the webcam
        // MediaPipe X is 0 to 1.
        const mapX = (x) => -(x - 0.5) * 12; // Wider map range for larger scene
        const mapY = (y) => -(y - 0.5) * 8;

        if (data.type === 'two_hands_zoom') {
            this.handMarker.visible = true;
            this.handMarker2.visible = true;
            this.magicWandActive = false;

            this.handMarker.position.x += (mapX(data.position.x) - this.handMarker.position.x) * 0.2;
            this.handMarker.position.y += (mapY(data.position.y) - this.handMarker.position.y) * 0.2;
            this.handMarker2.position.x += (mapX(data.position2.x) - this.handMarker2.position.x) * 0.2;
            this.handMarker2.position.y += (mapY(data.position2.y) - this.handMarker2.position.y) * 0.2;

            // Smoother, less sensitive zoom (reduced multiplier from 20 to 8)
            if (data.zoomDelta) {
                this.camera.position.z -= data.zoomDelta * 8.0;
                this.camera.position.z = Math.max(3, Math.min(20, this.camera.position.z));
            }
            return;
        }

        // ─── MAGIC WAND: both hands pinching ───────────────────────────────
        if (data.type === 'magic_wand') {
            this.magicWandActive = true;
            this.handMarker.visible = true;
            this.handMarker2.visible = true;

            this.handMarker.position.x += (mapX(data.position.x) - this.handMarker.position.x) * 0.25;
            this.handMarker.position.y += (mapY(data.position.y) - this.handMarker.position.y) * 0.25;
            this.handMarker.position.z = 6;

            this.handMarker2.position.x += (mapX(data.position2.x) - this.handMarker2.position.x) * 0.25;
            this.handMarker2.position.y += (mapY(data.position2.y) - this.handMarker2.position.y) * 0.25;
            this.handMarker2.position.z = 6;

            // Calculate distance between hands in mapped space
            const dx = mapX(data.position.x) - mapX(data.position2.x);
            const dy = mapY(data.position.y) - mapY(data.position2.y);
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            // Adjust radius of globe by scaling the entire group
            const targetScale = Math.max(0.3, Math.min(dist * 0.25, 3.0));
            this.carouselGroup.scale.set(
                this.carouselGroup.scale.x + (targetScale - this.carouselGroup.scale.x) * 0.1,
                this.carouselGroup.scale.y + (targetScale - this.carouselGroup.scale.y) * 0.1,
                this.carouselGroup.scale.z + (targetScale - this.carouselGroup.scale.z) * 0.1
            );
            return;
        }

        // Single hand — reset wand mode
        this.magicWandActive = false;

        // Single Hand Logic
        this.handMarker.visible = true;
        this.handMarker2.visible = false;

        this.handMarker.position.x += (mapX(data.position.x) - this.handMarker.position.x) * 0.2;
        this.handMarker.position.y += (mapY(data.position.y) - this.handMarker.position.y) * 0.2;
        this.handMarker.position.z = 6; // Move marker to the front surface of the globe

        const type = data.type;

        // IRON MAN MODE (Interacting with focused image)
        if (this.focusedMesh) {
            if (type === 'open_palm' && (data.deltaX || data.deltaY)) {
                
                // Throw Away (Dismiss) if swiping very fast
                if (Math.abs(data.deltaX) > 0.08 || Math.abs(data.deltaY) > 0.08) {
                    this.focusedMesh = null; // Releases it back to the globe
                    return;
                }
                
                // Otherwise drag the hologram around in 3D space
                // Map hand deltas to world space adjustments
                this.focusedMesh.position.x -= data.deltaX * 10.0;
                this.focusedMesh.position.y -= data.deltaY * 10.0;
            }

            if (type === 'peace') {
                this.focusedMesh = null;
            }
            return; // Skip normal globe rotation while focused
        }

        // Swiping mechanic to rotate the globe
        if (type === 'open_palm' && (data.deltaX || data.deltaY)) {
            // Moving hand left (negative deltaX) should rotate globe left (negative Y rotation)
            this.targetRotationY -= data.deltaX * 5.0; 
            // Moving hand up (negative deltaY) should rotate globe up (negative X rotation)
            this.targetRotationX -= data.deltaY * 5.0;
        }

        if (type === 'fist') {
            this.isPaused = true;
            this.handMarker.scale.set(0.5, 0.5, 0.5);
            this.handMarker.children[0].color.setHex(0xFF0000); 
        } else if (type === 'ok_sign') {
            this.isPaused = false;
            this.handMarker.scale.set(1.5, 1.5, 1.5);
            this.handMarker.children[0].color.setHex(0x00FF00); // Green
        } else if (type === 'four_fingers') {
            this.isPaused = false;
            this.handMarker.scale.set(1, 1, 1);
            this.handMarker.children[0].color.setHex(0xFFFF00); // Yellow
        } else {
            this.isPaused = false;
            this.handMarker.scale.set(1, 1, 1);
            this.handMarker.children[0].color.setHex(0xFFD1DC); 
        }

        if (type === 'pinch' && this.hoveredMesh && !this.focusedMesh) {
            this.focusedMesh = this.hoveredMesh;
        }

        if (type === 'love') {
            this.triggerExplosion();
        }

        if (type === 'thumbs_up') {
            this.targetRotationY += 0.2; // Speed up rotation
        }

        if (type === 'thumbs_down') {
            this.targetRotationY -= 0.2; // Reverse/speed up reverse rotation
        }

        if (type === 'call_me') {
            // Shake camera slightly
            this.camera.position.x = (Math.random() - 0.5) * 0.5;
            this.camera.position.y = (Math.random() - 0.5) * 0.5;
        } else {
            // Re-center camera (only affects x/y)
            this.camera.position.x += (0 - this.camera.position.x) * 0.1;
            this.camera.position.y += (0 - this.camera.position.y) * 0.1;
        }
    }

    triggerExplosion() {
        if (this.isExploding) return;
        this.isExploding = true;
        this.focusedMesh = null;

        // Blast particles
        for (let i = 0; i < this.particleCount; i++) {
            this.velocities[i*3]   = (Math.random() - 0.5) * 3.0;
            this.velocities[i*3+1] = (Math.random() - 0.5) * 3.0;
            this.velocities[i*3+2] = (Math.random() - 0.5) * 3.0;
        }

        // Blast every photo outward with random velocity
        this.meshVelocities = this.memoryMeshes.map(() => new THREE.Vector3(
            (Math.random() - 0.5) * 0.5,
            (Math.random() - 0.5) * 0.5,
            (Math.random() - 0.5) * 0.5
        ));

        // Show love overlay
        const overlay = document.getElementById('love-overlay');
        if (overlay) overlay.classList.add('visible');

        // Launch fireworks
        this.startFireworks();

        // Shake the upload button
        const btn = document.getElementById('add-photo-btn');
        if (btn) {
            btn.style.transform = 'scale(1.3)';
            btn.style.boxShadow = '0 0 30px #FF69B4';
            setTimeout(() => { btn.style.transform = ''; btn.style.boxShadow = ''; }, 600);
        }

        // Reset after 4 seconds
        clearTimeout(this.explosionTimer);
        this.explosionTimer = setTimeout(() => this.resetExplosion(), 4000);
    }

    resetExplosion() {
        this.isExploding = false;
        this.meshVelocities = [];

        // Hide love overlay
        const overlay = document.getElementById('love-overlay');
        if (overlay) overlay.classList.remove('visible');

        this.stopFireworks();
    }

    initFireworks() {
        this.fwCanvas = document.getElementById('fireworks-canvas');
        if (!this.fwCanvas) return;
        this.fwCanvas.width = window.innerWidth;
        this.fwCanvas.height = window.innerHeight;
        this.fwCtx = this.fwCanvas.getContext('2d');
        this.fwParticles = [];
        this.fwRunning = false;
        this.fwRaf = null;

        window.addEventListener('resize', () => {
            if (this.fwCanvas) {
                this.fwCanvas.width = window.innerWidth;
                this.fwCanvas.height = window.innerHeight;
            }
        });
    }

    startFireworks() {
        if (!this.fwCanvas) return;
        this.fwCanvas.style.display = 'block';
        this.fwRunning = true;
        this.fwParticles = [];
        this._fwLoop();
    }

    stopFireworks() {
        this.fwRunning = false;
        if (this.fwRaf) cancelAnimationFrame(this.fwRaf);
        if (this.fwCanvas) this.fwCanvas.style.display = 'none';
    }

    _fwLoop() {
        if (!this.fwRunning) return;
        const ctx = this.fwCtx;
        const W = this.fwCanvas.width, H = this.fwCanvas.height;

        ctx.fillStyle = 'rgba(5,10,31,0.18)';
        ctx.fillRect(0, 0, W, H);

        // Random burst more frequently
        if (Math.random() < 0.25) {
            const colors = ['#FFD1DC','#FF69B4','#FFB6C1','#c7a0ff','#4169E1','#ffffff','#ffe4ff'];
            const cx = Math.random() * W;
            const cy = Math.random() * H * 0.65 + 30;
            const color = colors[Math.floor(Math.random() * colors.length)];
            const count = 100 + Math.floor(Math.random() * 80);
            for (let i = 0; i < count; i++) {
                const angle = (Math.PI * 2 * i) / count;
                const speed = 2 + Math.random() * 8;
                this.fwParticles.push({
                    x: cx, y: cy,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    life: 1.0,
                    decay: 0.012 + Math.random() * 0.018,
                    color,
                    size: 2 + Math.random() * 2.5,
                    trail: []
                });
            }
        }

        // Update & draw
        this.fwParticles = this.fwParticles.filter(p => p.life > 0);
        for (const p of this.fwParticles) {
            p.trail.push({ x: p.x, y: p.y });
            if (p.trail.length > 5) p.trail.shift();

            // Draw trail
            for (let t = 0; t < p.trail.length - 1; t++) {
                const alpha = (t / p.trail.length) * p.life * 0.5;
                ctx.strokeStyle = p.color;
                ctx.globalAlpha = alpha;
                ctx.lineWidth = p.size * 0.5;
                ctx.beginPath();
                ctx.moveTo(p.trail[t].x, p.trail[t].y);
                ctx.lineTo(p.trail[t+1].x, p.trail[t+1].y);
                ctx.stroke();
            }

            // Draw spark
            ctx.globalAlpha = p.life;
            ctx.fillStyle = p.color;
            ctx.shadowBlur = 10;
            ctx.shadowColor = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;

            p.x  += p.vx;
            p.y  += p.vy;
            p.vy += 0.09; // gravity
            p.vx *= 0.98;
            p.life -= p.decay;
        }
        ctx.globalAlpha = 1;

        this.fwRaf = requestAnimationFrame(() => this._fwLoop());
    }

    playSobbingNoise() {
        // Use Web Speech API to make Hrishav sob dramatically
        const lines = [
            "Hrishav is crying... please say yes...",
            "Hrishav sobbing uncontrollably...",
            "No no no... Hrishav is heartbroken..."
        ];
        const line = lines[Math.floor(Math.random() * lines.length)];

        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const utter = new SpeechSynthesisUtterance(line);
            utter.rate = 0.75;
            utter.pitch = 0.6;
            utter.volume = 1.0;
            // Try to pick a soft/sad voice
            const voices = window.speechSynthesis.getVoices();
            const softVoice = voices.find(v => v.lang.startsWith('en'));
            if (softVoice) utter.voice = softVoice;
            window.speechSynthesis.speak(utter);
        } else {
            // Fallback: synth sob tone
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            osc.type = 'triangle';
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            osc.frequency.setValueAtTime(450, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(150, audioCtx.currentTime + 1.8);
            gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.6, audioCtx.currentTime + 0.2);
            gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 2.0);
            osc.start(audioCtx.currentTime);
            osc.stop(audioCtx.currentTime + 2.0);
        }
    }

    _updateGestureLabel(type) {
        const el = document.getElementById('gesture-label');
        if (!el) return;
        const map = {
            'open_palm': '✋ Open Palm',
            'pinch':     '🤏 Pinch',
            'peace':     '✌️ Peace',
            'fist':      '✊ Fist',
            'love':      '🤟 I Love You',
            'thumbs_up': '👍 Thumbs Up',
            'thumbs_down':'👎 Thumbs Down',
            'ok_sign':   '👌 OK Sign',
            'call_me':   '🤙 Call Me',
            'four_fingers':'🖐️ Four Fingers',
            'two_hands_zoom':'👐 Two Hands Zoom',
            'magic_wand':'🤏🤏 Magic Wand',
            'point_up':  '☝️ Point Up',
            'point_down':'👇 Point Down',
            'smile':     '😊 Smile',
            '—':         '— None'
        };
        el.textContent = map[type] || ('🖐 ' + type);
    }

    uiSetup() {
        const btnYes = document.getElementById('btn-yes');
        const btnNo  = document.getElementById('btn-no');
        const statusText = document.getElementById('status-text');

        // ── NO: sob, grow/shrink loop, then disappear ─────────────────────
        let noClickCount = 0;
        const MAX_NO_CLICKS = 9;

        const handleNo = () => {
            if (noClickCount >= MAX_NO_CLICKS) return;
            noClickCount++;

            btnYes.disabled = true;
            btnNo.disabled  = true;
            this.playSobbingNoise();

            // Shake the question heading
            const q = document.getElementById('love-question');
            if (q) {
                q.style.transition = 'transform 0.1s';
                q.style.transform = 'translateX(-8px) rotate(-2deg)';
                setTimeout(() => { q.style.transform = 'translateX(8px) rotate(2deg)'; }, 150);
                setTimeout(() => { q.style.transform = 'none'; }, 300);
            }

            // Yes grows, No shrinks each time
            const shrinkFactor = 1 - noClickCount * 0.09;
            const growFactor   = 1 + noClickCount * 0.12;

            btnNo.style.transition  = 'transform 0.5s ease, opacity 0.5s ease, font-size 0.5s ease';
            btnYes.style.transition = 'transform 0.5s ease, font-size 0.5s ease';
            btnNo.style.transform   = `scale(${Math.max(shrinkFactor, 0.05)})`;
            btnNo.style.opacity     = `${Math.max(shrinkFactor, 0.05)}`;
            btnYes.style.transform  = `scale(${Math.min(growFactor, 2.2)})`;

            setTimeout(() => {
                if (noClickCount >= MAX_NO_CLICKS) {
                    // Final time — remove No button entirely
                    btnNo.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
                    btnNo.style.opacity = '0';
                    btnNo.style.transform = 'scale(0) rotate(180deg)';
                    setTimeout(() => { btnNo.style.display = 'none'; }, 650);

                    // Make Yes pulse with a big glow
                    btnYes.style.transition = 'all 0.5s ease';
                    btnYes.style.transform  = 'scale(2.4)';
                    btnYes.style.boxShadow  = '0 0 40px #FF69B4, 0 0 80px #FF1493';
                    btnYes.disabled = false;

                    if (q) { q.innerText = '💕 You know the answer...'; }
                } else {
                    btnYes.disabled = false;
                    btnNo.disabled  = false;
                }
            }, 2600);
        };

        btnNo.addEventListener('click', handleNo);

        // ── YES: launch the app ────────────────────────────────────────────
        const handleYes = async () => {
            btnYes.disabled = true;
            btnNo.disabled  = true;

            const q = document.getElementById('love-question');
            if (q) { q.innerText = '💕 Launching...'; q.style.fontSize = '1.6rem'; q.style.color = '#fff'; }

            const videoElement = document.getElementById('input-video');
            const tracker = new HandTracker(
                videoElement,
                this.handleGesture.bind(this),
                (ratio) => { // onSmile callback — fully decoupled from hand gestures
                    const now = Date.now();
                    if (now - this.lastSmileTime > 6000) {
                        this.lastSmileTime = now;
                        this.showCompliment();
                    }
                }
            );

            try {
                await tracker.start();

                // Fade out the prompt
                const screen = document.getElementById('loading-screen');
                screen.style.transition = 'opacity 0.5s';
                screen.style.opacity = '0';
                setTimeout(() => {
                    screen.style.display = 'none';
                }, 520);

                // Control panel
                const cp = document.getElementById('control-panel');
                if (cp) cp.style.display = 'block';

                // Minimize button
                const guide  = document.getElementById('control-panel');
                const minBtn = document.getElementById('minimize-btn');
                if (guide && minBtn) {
                    minBtn.addEventListener('click', () => {
                        guide.classList.toggle('minimized');
                        minBtn.textContent = guide.classList.contains('minimized') ? '+' : '−';
                    });
                }

                // Upload logic
                const fileInput = document.getElementById('photo-upload');
                const uploadBtn = document.getElementById('add-photo-btn');
                if (fileInput && uploadBtn) {
                    uploadBtn.addEventListener('click', () => fileInput.click());
                    fileInput.addEventListener('change', (e) => {
                        const files = e.target.files;
                        if (!files.length) return;
                        if (!this.hasUserPhotos) {
                            this.hasUserPhotos = true;
                            this.memoryMeshes.forEach(mesh => {
                                this.carouselGroup.remove(mesh);
                                mesh.geometry.dispose();
                                if (mesh.material.uniforms?.map?.value) mesh.material.uniforms.map.value.dispose();
                                mesh.material.dispose();
                            });
                            this.memoryMeshes = [];
                            this.focusedMesh  = null;
                            this.hoveredMesh  = null;
                        }
                        const tl = new THREE.TextureLoader();
                        Array.from(files).forEach(file => {
                            const reader = new FileReader();
                            reader.onload = ev => {
                                tl.load(ev.target.result, tex => {
                                    this.addPhotoToGlobe(tex, this.memoryMeshes.length);
                                    this.recalculateGlobe();
                                });
                            };
                            reader.readAsDataURL(file);
                        });
                    });
                }

                // Caption logic
                const captionInput = document.getElementById('caption-input');
                if (captionInput) {
                    captionInput.addEventListener('input', e => {
                        if (this.focusedMesh) this.focusedMesh.userData.caption = e.target.value;
                    });
                }

            } catch (err) {
                console.error(err);
                if (q) { q.innerText = '❌ Camera denied. Please refresh.'; q.style.color = '#f88'; }
                btnYes.disabled = false;
                btnNo.disabled  = false;
            }
        };

        btnYes.addEventListener('click', handleYes);
    }
}

window.onload = () => {
    new MemoryTheater();
};
