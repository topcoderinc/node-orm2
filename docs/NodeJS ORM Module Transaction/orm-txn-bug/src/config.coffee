# Copyright (C) 2014 TopCoder Inc., All Rights Reserved.

###
  configuration module

  @author TCSASSEMBLER
  @version 1.0
  @since 1.0
  @module config

###

module.exports =
  database:
    user: "postgres"
    port: 5432
    password: "topcoder"
    host: "localhost"
    name: "mydb"
    override_url:  process.env.DATABASE_URL
