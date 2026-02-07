const https = require("https");

const data = JSON.stringify({
  bookId: 1,
  customerName: "yakuza",
});

const options = {
  hostname: "simple-books-api.click",
  path: "/orders/",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
    Authorization:
      "Bearer e92e8fa2a716670173180616f0ac4eabf57c2f90fcea4be8dc366ce8ce7e46fd",
  },
};

const req = https.request(options, (res) => {
  let body = "";

  res.on("data", (chunk) => {
    body += chunk;
  });

  res.on("end", () => {
    console.log(body);
  });
});

req.on("error", (err) => {
  console.error(err);
});

req.write(data);
req.end();
