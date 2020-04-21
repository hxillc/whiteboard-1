var PORT = 8080; //Set port for the app
var accessToken = ""; //Can be set here or as start parameter (node server.js --accesstoken=MYTOKEN)
var disableSmallestScreen = false; //Can be set to true if you dont want to show (node server.js --disablesmallestscreen=true)
var webdav = false; //Can be set to true if you want to allow webdav save (node server.js --webdav=true)

var fs = require("fs-extra");
var fsp = require("fs-extra-promise");
var express = require('express');
var bodyParser = require('body-parser');
var formidable = require('formidable'); //form upload processing

const createDOMPurify = require('dompurify'); //Prevent xss
const { JSDOM } = require('jsdom');
const window = (new JSDOM('')).window;
const DOMPurify = createDOMPurify(window);

const { createClient } = require("webdav");

var s_whiteboard = require("./s_whiteboard.js");

var app = express();
app.use(express.static(__dirname + '/public'));

// accept large bodies
// app.use(bodyParser.json({ parameterLimit: 5000000, limit: '5000kb' }));
// app.use(bodyParser.urlencoded({ parameterLimit: 500000000, limit: '500000kb', extended: false }));


var webdavaccess = {
  webdavserver: 'https://cloud.ruptive.cx/remote.php/dav/files/whiteboard/',
  webdavpath: '/whiteboards/',
  webdavusername: 'whiteboard',
  webdavpassword: 'whiteboard'
}

var client = createClient(
  webdavaccess.webdavserver,
  {
    username: webdavaccess.webdavusername,
    password: webdavaccess.webdavpassword
  }
)

if (process.env.accesstoken) {
    accessToken = process.env.accesstoken;
}
if (process.env.disablesmallestscreen) {
    disablesmallestscreen = true;
}
if (process.env.webdav) {
    webdav = true;
}

var startArgs = getArgs();
if (startArgs["accesstoken"]) {
    accessToken = startArgs["accesstoken"];
}
if (startArgs["disablesmallestscreen"]) {
    disableSmallestScreen = true;
}
if (startArgs["webdav"]) {
    webdav = true;
}

if (accessToken !== "") {
    // console.log("AccessToken set to: " + accessToken);
}
if (disableSmallestScreen) {
    console.log("Disabled showing smallest screen resolution!");
}
if (webdav) {
    // console.log("Webdav save is enabled!");
}

// app.get('/loadwhiteboard', function (req, res) {
//     var wid = req["query"]["wid"];
//     var at = req["query"]["at"]; //accesstoken
//     if (accessToken === "" || accessToken == at) {
//         var ret = s_whiteboard.loadStoredData(wid);
//         res.send(ret);
//         res.end();
//     } else {
//         res.status(401);  //Unauthorized
//         res.end();
//     }
// });

app.get('/loadwhiteboard', function (req, res) {
  var whiteboardId = req["query"]["wid"];
  var at = req["query"]["at"]

  if(accessToken === "" || accessToken == at) {
    client.getFileContents(`${webdavaccess.webdavpath}${whiteboardId}/${whiteboardId}.json`, { format: "text" })
    .then(data => {
      if(data) {
        data = JSON.parse(data)
      }
      else {
        data = []
      }
      res.status(200).send(data)
    })
    .catch(err => {
      // console.log(err.response)

      res.status(200).send('no file')
    })
  }
  else {
    res.sendStatus(500)
  }
})

app.post('/save', function (req, res) { //File upload
  return processFormData(req, res)
});

app.post('/upload', function (req, res) { //File upload
  return processFormData(req, res)
});

function processFormData(req, res) {
  var form = new formidable.IncomingForm(); //Receive form
  var formData = {
      files: {},
      fields: {}
  }
  form.on('file', function (name, file) {
      formData["files"][file.name] = file;
  });
  form.on('field', function (name, value) {
      formData["fields"][name] = value;
  });
  form.on('error', function (err) {
      console.log('File uplaod Error!');
  });
  form.on('end', function () {
    if (accessToken === "" || accessToken == formData["fields"]["at"]) {
      progressUploadFormData(formData)
      .then(() => {
        res.send('done')
      })
      .catch(err => {
        err == '403' ? res.sendStatus(403) : res.sendStatus(500)
      })
    } else {
        res.status(401);  //Unauthorized
        res.end();
    }
    //End file upload
  });
  form.parse(req);
}

function progressUploadFormData(formData) {
  return new Promise((resolve, reject) => {
    var whiteboardId = formData.fields["whiteboardId"];
    var fields = escapeAllContentStrings(formData.fields);
    var files = formData.files;

    var date = fields["date"] || (+new Date());

    var imagefile = `${fields["name"] || whiteboardId}.png`;
    var jsonfile  = `${whiteboardId}.json`;

    var imagedata  = fields["imagedata"];
    var imagejson  = fields["imagejson"];
    var imagepath  = './public/uploads';
    var remotePath = `${webdavaccess.webdavpath}${whiteboardId}`;

    client.createDirectory(remotePath).finally(() => {
      if(imagedata) {
        // convert base64 to binary
        imagedata = Buffer.from(imagedata.replace(/^data:image\/png;base64,/, "").replace(/^data:image\/jpeg;base64,/, ""), 'base64');

        if(imagejson) {
          Promise.all([
            client.putFileContents(`${remotePath}/${imagefile}`, imagedata),
            client.putFileContents(`${remotePath}/${jsonfile}`, JSON.stringify(imagejson, null, 2))
          ])
          .then(()   => resolve('files uploaded'))
          .catch(err => reject(err))
        }
        else {
          client.putFileContents(`${remotePath}/${imagefile}`, imagedata)
          .then((stuff) => {
            console.log(stuff)
            resolve('files uploaded')
          })
        }
      }
      else {
        reject("no imagedata!");
      }
    })
  })
}


//Prevent cross site scripting (xss)
function escapeAllContentStrings(content, cnt) {
    if (!cnt)
        cnt = 0;

    if (typeof (content) === "string") {
        return DOMPurify.sanitize(content);
    }
    for (var i in content) {
        if (typeof (content[i]) === "string") {
            content[i] = DOMPurify.sanitize(content[i]);
        } if (typeof (content[i]) === "object" && cnt < 10) {
            content[i] = escapeAllContentStrings(content[i], ++cnt);
        }
    }
    return content;
}

function getArgs() {
    const args = {}
    process.argv
        .slice(2, process.argv.length)
        .forEach(arg => {
            // long arg
            if (arg.slice(0, 2) === '--') {
                const longArg = arg.split('=')
                args[longArg[0].slice(2, longArg[0].length)] = longArg[1]
            }
            // flags
            else if (arg[0] === '-') {
                const flags = arg.slice(1, arg.length).split('')
                flags.forEach(flag => {
                    args[flag] = true
                })
            }
        })
    return args
}

process.on('unhandledRejection', error => {
    // Will print "unhandledRejection err is not defined"
    console.log('unhandledRejection', error.message);
})


var server = require('http').Server(app);
server.listen(PORT);
