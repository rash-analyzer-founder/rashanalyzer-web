import { Canvas } from "@react-three/fiber"
import { useRef } from 'react'
import { useFrame } from "@react-three/fiber"
function ThreeD() {
  const box = useRef(null); 
  return (
    <Canvas>
      <ambientLight intensity={1} />
      <pointLight position={[10, 10, 10]} />
      <directionalLight position={[10, 10, 10.01]} />
      <mesh ref={box} position={[1, 1, 1]}>
        <boxGeometry args={[10,1,1]} />
        <meshStandardMaterial color="red" />
      </mesh>
    </Canvas>
  )
}

export default ThreeD 