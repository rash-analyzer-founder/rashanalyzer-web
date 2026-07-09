import React from 'react';

function FruitList() {
  const fruits = [{fruit: 'Apple', id: 1}, {fruit: 'Banana', id: 2}, {fruit: 'Orange', id: 3}, {fruit: 'Mango', id: 4}];

  return (
    <ul>
      {fruits.map((fruit) => (
        <li key={fruit.id}>{fruit.fruit}</li>
      ))}
    </ul>
  );
}

export default FruitList;
