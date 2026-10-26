# Studie+ Schedule Reader

This program automatically reads your schedule from Studie+ and sets your alarm accordingly so you never again have to manually have to set it yourself and it makes sure never to wake you too late or too early ever again.\
It requires one person to host an API on their server.

## Setup guide for user

Comming soon!

## Setup guide for host

Download on your server and run the following commands in the directory:

```
npm install
npx playwright install chromium
npm start
```

The first time you run `npm start` you will be asked for login information that will be safed in `config.json`. All this information is nescassary for the program to function, however you should **never _EVER_** write these types of information into a program that asks for them unless you fully understand what it intails or if you _want_ to get hacked.\
The information you will be asked for is the following:

1. Your UniLogin username
2. Your UniLogin password
3. Your institution number
4. A so called "Strong Name"
5. A so called "Permutation"
6. The low and high bounds of room IDs in your school
7. The low and high bounds of teacher IDs in your school
