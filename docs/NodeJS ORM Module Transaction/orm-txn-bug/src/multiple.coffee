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
Chance = require 'chance'
orm = require 'orm'
winston = require 'winston'

# local modules
config = require('./config').database

# init chance instance
chance = new Chance()

# connect to DB using configuration variables
orm.settings.set 'instance.cache', false
port =  if config.port then ":#{config.port}" else ""
url = config.override_url ? "postgres://#{config.user}:#{config.password}@#{config.host}#{port}/#{config.name}"
url = "#{url}?pool=true&debug=true" # enable debug and pooling

orm.connect url, (err, db) ->
  throw err if err

  # database models for testing
  Person = db.define('person',
    name: String
    gender: [ 'female', 'male' ]
    age: Number
  )

  Person.drop ->
    Person.sync (err) ->
      throw err if err
      # insert one person before
      db.transaction (err, txn) ->
        # create 10 db operations
        async.times 10, (n, cb) ->
          console.log 'operation: exec INSERT'
          Person.create {
            name: chance.name()
            gender: chance.gender().toLowerCase()
            age: chance.age()
          }, txn, (err, person) ->
            cb err, person
        , (err, results) ->
          console.log 'Rollbacking the inserted data'
          txn.rollback (err2) ->
            console.log err2 if err2
            Person.count (err3, count) ->
              if err3
                console.log err3
              else
                console.log "There are #{count} person in database. This should be 0."
              console.log 'done'
              process.exit 0

