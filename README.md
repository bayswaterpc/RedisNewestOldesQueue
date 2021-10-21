RedisNewestOldesQueue

This project is a demonstration of using redis and creating various custom Evection policies such as Newest First, Oldest First, and Maximum Fill

It is configured to work with OpenApi and swagger
# Running
From the root folder run `docker-compose up`

In a seperate terminal 
`yarn`
`yarn build`
`yarn start`

For running queiries against the API You can access the swagger page at
http://localhost:3000/docs/

# Configuring
For configuring the Eviction Policy, TTL, Number of Keys, Host address, or Cache Port see the .env file. 

Available eviction policies can be set to the following strings, "OldestFirst", "NewestFirst", "Reject"