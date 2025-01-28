# Write.JS

Lightweight, multi-platform Text Editor with possibility to store documents in the cloud.


## About infrastructure
Application is developed in 1 repository and can be divided to two areas:
- Web app
- Server App
__Web App__ is written in JavaScript in /static/script.js file

__Server App__ is written in Python with FastAPI framework


There are no separate web server, everything is served as static files by FastApi app.




## Environment setup
1. Install Python3
2. Install packages
```
pip install -r requirements.txt
```
3. Run server locally
```
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```
## Tests
Tests are located in another repository - [Playwright Repository](https://github.com/milessic/playwright-js-demo)



# Contribution
If you want to be a part of the project as:
- developer
- tester
- UI/UX designer
Don't hesitate and write to [Write.JS mailbox](mailto:writejs.help@gmail.com?subject=Contribution)!
