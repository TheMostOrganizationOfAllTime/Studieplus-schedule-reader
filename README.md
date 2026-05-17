# SkemaBot
SkemaBot is a server application that allows secondary bots and services to access the schedules of students at Danish high schools.\
The system works by storing login sessions for students who have authenticated through the server. It cannot access schedules for students who have not been added to the system.
## Features
* Fetch combined schedules for all registered students
* Simple REST API
* Quick endpoints for today's and tomorrow's schedules
* Supports adding users through API requests
## API Usage
### Get Schedule for a Specific Date
```
curl -X POST http://YOUR_IP/get \
  -H "Content-Type: application/json" \
  -d '{"date":"yy-mm-dd"}'
```
### Get Today's Schedule
```
curl -X GET http://YOUR_IP/today
```
### Get Tomorrow's Schedule
```
curl -X GET http://YOUR_IP/tomorrow
```
### Add Student
To add students, you send their UniLogin credentials.
```
curl -X POST http://YOUR_IP/addUser \
  -H "Content-Type: application/json" \
  -d '{"username":"user1234","password":"bamse1000"}'
```
Replace: `username` with the student's UniLogin username and `password` with the student's UniLogin password.
## Known Issues
* Notes and homework are currently attached to the class *before* the intended class. If it is the first class of the day, it is attached to the last class of the day.
## TODO
### Configuration System
Create a configuration file to provide more control for administrators.\
Planned features:
* Change which school the program uses\
*(currently only supports Aarhus Tech)*
* Sort subjects into groups such as electives
* Declare which subjects or groups do not require attendance tracking
### Discord Bot Integration
Create a Discord bot for schedule notifications.\
Planned features:
* Notify students when the next school day starts later than usual
* Send notifications only to relevant students\
*(for example when an elective class is cancelled)*
* Configure normal meeting times for each weekday, holidays and non-school dates to suppress excessive notifications
### Web Interface
Create a simple HTML web interface allowing any student to give the server their UniLogin credentials without needing to run terminal commands.
### Assignment Support
Create a similar tool to the schedule fetcher, that collects data about what assignments are due soon.\
Planned features:
* An endpoint to get a list of assignments due after the point of fetching.
	* The list should be sorted from closest to due date to furthest from due date.
	* Each assignment should include due date, name, subject and student time
* An endpoint to get a list of assignments due after the point of fetching with more information.
	* The list should be sorted from closest to due date to furthest from due date.
	* Each assignment should include due date, name, subject, student time, if there are groups, assignment description and any relevant files.
* An endpoint to get info about an assignments of a given name.
	* The info should inlcude due date, name, subject, student time, if there are groups, assignment description and any relevant files.
