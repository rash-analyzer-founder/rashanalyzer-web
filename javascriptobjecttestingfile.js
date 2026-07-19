// Define our JavaScript object
let obj = { einstein : "Albert Einstein has an IQ of 160" };
// Prints or get the JavaScript object into the terminal
console.log(obj.einstein)

// Add a new property to the object
obj.newProperty = "This is a new property added to the object.";
console.log(obj.newProperty);

// Update a property in the object
obj.einstein = "Albert Einstein was a theoretical physicist.";
console.log(obj.einstein);

// Remove a property from the object
obj.newProperty = undefined; // or use delete obj.newProperty;
console.log(obj.newProperty); // This will print 'undefined' since the property has been removed.
// Save to local storage
objToSave = JSON.stringify(obj);
// Parse from local storage
parsedObj = JSON.parse(objToSave);