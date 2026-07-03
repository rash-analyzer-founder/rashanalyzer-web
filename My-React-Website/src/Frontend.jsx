import { useState } from 'react';

function App() {
  const [message, setMessage] = useState('Click the button to load data.');

  const fetchData = async () => {
    try {
      // Call the backend URL
      const response = await fetch('http://localhost:3000/api/message');
      const data = await response.json();
      
      // Update state with the backend response
      setMessage(data.text); 
    } catch (error) {
      setMessage('Error connecting to backend.');
      console.error(error);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>React Frontend</h1>
      <button onClick={fetchData}>Get Data From Backend</button>
      <p>{message}</p>
    </div>
  );
}

export default App;
