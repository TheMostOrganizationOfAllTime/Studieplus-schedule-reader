## SkemaBot
This program is intended to be run on a server with the purpose of being a way for secondary bots to access the schedule of students in danish highschools.\
It is not able to access the schedule of any student not loged in via the server on which this program runs.\
When the server is running, it will be possible to access the combined schedule of every student stored on your server by running: `curl -X POST YOURIP/get -H "Content-Type: application/json" -d '{"date":"yy-mm-dd"}'`.\
It is also possible to use the short hand `curl -X GET http://YOURIP/tomorrow -H "Content-Type: application/json"` for tomorrows schedule and `curl -X GET http://YOURIP/today -H "Content-Type: application/json"` for todays schedule.\
To add students to your system, you need to run `curl -X POST http://YOURIP/addUser -H "Content-Type: application/json" -d '{"username":"user1234","password":"bamse1000"}'` replacing 'username' and 'password' with the UniLogin username and password of the student.
## Known issues
* Notes and homework will be attached to the class before the class they are supposed to. If the note/homework belongs to the first class of the day, the note/homework will be attached to the last class of the day.
## TODO
* Create a config file for more control to the admin.
	* A way of changing what school the program uses. Currently only 'Aarhus Tech'.
	* A way of sorting subjects into groups like 'electives'.
	* A way of declaring which subjects and groups doesn't require attendence.
* Make a discord bot to make it possible to recieve notifications when the following day starts later than usual
	* Have a way of notifying only the relevant people, incase, for example, an elective subject have been cancled.
	* A way of declaring what time it is usual to meet each day.
	* A way of declaring what dates there are no school and the bot there shouldn't notify.
* Create a simple HTML website that allows students to enter their logins at the IP without needing admin interference.
* Expand the system to include assignments.
