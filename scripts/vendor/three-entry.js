// The parts of three.js (MIT) that Lanternkeep uses, re-exported by name so esbuild can leave the rest out
// (notably every loader, which would bring network code into the game). Build: npm run build:three.
export {
  WebGLRenderer, WebGLRenderTarget, Scene, PerspectiveCamera, OrthographicCamera, Color, Vector2, Vector3, Vector4, Matrix4,
  Quaternion, Euler, Object3D, Group, Mesh, InstancedMesh, Points, Sprite, SpriteMaterial, BufferGeometry, BufferAttribute,
  Float32BufferAttribute, InstancedBufferAttribute, PlaneGeometry, BoxGeometry, SphereGeometry, CylinderGeometry, ConeGeometry,
  CapsuleGeometry, LatheGeometry, TorusGeometry, TubeGeometry, ShapeGeometry, ExtrudeGeometry, IcosahedronGeometry,
  OctahedronGeometry, DodecahedronGeometry, RingGeometry, CircleGeometry, Shape, CatmullRomCurve3, QuadraticBezierCurve3,
  MeshStandardMaterial, MeshPhysicalMaterial, MeshBasicMaterial, MeshLambertMaterial, ShaderMaterial, PointsMaterial,
  HemisphereLight, DirectionalLight, PointLight, AmbientLight, FogExp2, Raycaster, Plane, CanvasTexture, Texture,
  PMREMGenerator, SRGBColorSpace, ACESFilmicToneMapping, AgXToneMapping, NeutralToneMapping, NoToneMapping, PCFShadowMap,
  AdditiveBlending, NormalBlending, DoubleSide, FrontSide, BackSide, RepeatWrapping, ClampToEdgeWrapping, LinearFilter,
  HalfFloatType, MathUtils, Box3, Sphere,
} from 'three';
export { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
export { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
export { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
export { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
export { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
export { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
export { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
export { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
export { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
export { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
