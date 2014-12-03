#  Copyright (C) 2014 TopCoder Inc., All Rights Reserved.

###
  Module foe testing orm2 transaction bug

  @author TCSASSEMBLER
  @version 1.0
  @since 1.0
  @module app
###

# 3rd party modules
async = require 'async'
orm = require 'orm'
winston = require 'winston'

# local modules
config = require('./config').database

# connect to DB using configuration variables
orm.settings.set 'instance.cache', false
port =  if config.port then ":#{config.port}" else ""
url = config.override_url ? "postgres://#{config.user}:#{config.password}@#{config.host}#{port}/#{config.name}"
url = "#{url}?pool=true&debug=true" # enable debug

orm.connect url, (err, db) ->
  throw err if err

  # database models for testing
  Person = db.define('person',
    name: String
    gender: [ 'female', 'male' ]
    age: Number
  )

  # sample data. Second one contains an error
  first =
    name: 'jane roe'
    gender: 'female'
    age: 27
  second =
    name: 'john doe'
    gender: 'mal3'
    age: 23

  Person.drop ->
    Person.sync (err) ->
      throw err if err
      # insert one person before
      Person.create first, (err, person) ->
        throw err if err
         # create 2 transactions in parallel
        async.parallel [
          (cb) ->
            console.log 'operation 1: call BEGIN'
            db.transaction (err, txn1) ->
              console.log "operation 1: after BEGIN"
              fncb = (err, p) ->
                console.log "operation 1: commit or rollback"
                if err
                  console.log "Error on operation 1: #{err}" if err
                  txn1.rollback (err2) ->
                    console.log err2 if err2
                    cb null, 'ERROR'
                else
                  txn1.commit (err2) ->
                    console.log err2 if err2
                    cb null, 'OK'
              console.log 'operation 1: exec INSERT'
              Person.create second, txn1, (err2, p) ->
                setTimeout fncb, 500, err2, p
          (cb) ->
            console.log 'operation 2: call BEGIN'
            db.transaction (err, txn2) ->
              console.log "operation 2: after BEGIN"
              Person.get person.id, txn2, (err, person) -> 
                fncb = (err, p) ->
                  console.log "operation 2: commit or rollback"
                  if err
                    console.log "Error on operation 2: #{err}" if err
                    txn2.rollback (err2) ->
                      console.log err2 if err2
                      cb null, 'ERROR'
                  else
                    txn2.commit (err2) ->
                      console.log err2 if err2
                      cb null, 'OK'
                console.log 'operation 2: exec REMOVE'
                person.remove (err2) ->
                  setTimeout fncb, 200, err2
        ], (err, results) ->
          winston.error err if err
          console.log 'done'
          process.exit 0

