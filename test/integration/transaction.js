/**
 * This test case tests all possible scenarios with transaction
 */
"use strict";

var should   = require('should');
var async   = require('async');
var helper   = require('../support/spec_helper');
var common   = require('../common');
var ORM      = require('../../');


/**
 * Get sample data to create new person
 * @returns {Object} sample data
 */
function getSamplePerson() {
    return { name : "John Doe", gender: 'female' };
}

describe("transaction (pool)", function () {
    if (common.protocol() !== 'postgres') return;

    var db = null;
    var Pet = null;
    var Person = null;

    /**
     * Recreate Pet and Person tables
     * @returns {Function} the setup function
     */
    var setup = function () {
        return function (done) {
            Person = db.define("person", {
                name   : String,
                gender: [ 'female', 'male' ],
                age: Number
            }, { cache: false });
            Pet = db.define("pet", {
                name   : { type: "text", defaultValue: "Mutt" }
            }, { cache: false });
            Person.hasMany("pets", Pet);
            Person.hasOne("favPet", Pet);

            return helper.dropSync([ Person, Pet ], done);
        };
    };

    before(function (done) {
        common.createConnection({query: {pool: true}}, function (err, connection) {
            if (err) {
                return done(err);
            }
            db = connection;
            return done();
        });
    });

    beforeEach(setup());


    /**
     * Call model.Count() with without transaction, before and after transaction
     * And assert results
     * @param model the model to call
     * @param t the current transaction
     * @param current the expected count without transaction
     * @param beforeCommit the expected count before committing the transaction
     * @param afterCommit the expected count after committing the transaction
     * @param done the callback function
     */
    function assertCount(model, t, current, beforeCommit, afterCommit, done) {
        async.waterfall([
            function (cb) {
                //without transaction
                model.count(cb);
            }, function (count, cb) {
                count.should.be.equal(current);
                //with transaction
                model.count(t, cb);
            }, function (count, cb) {
                count.should.be.equal(beforeCommit);
                t.commit(cb);
            }, function (cb) {
                model.count(cb);
            }, function (count, cb) {
                count.should.be.equal(afterCommit);
                cb();
            }
        ], done);
    }


    /**
     * Release transaction if transaction is not done
     * @param {Function} fn the getter for transaction
     * @returns {Function} the cleanup function
     */
    function releaseTransaction(fn) {
        return function (done) {
            var transaction = fn();
            if (transaction && !transaction.isDone) {
                // just try to release the connection
                transaction.rollback(function () {
                    done();
                });
            } else {
                done();
            }
        }
    }

    //test cases with creation
    describe("create Person", function () {

        it("create using new Person()", function (done) {
            db.transaction(function (err, t) {
                if (err) {
                    return done(err);
                }
                async.waterfall([
                    function (cb) {
                        var person = new Person(getSamplePerson());
                        person.transaction = t;
                        person.save(cb);
                    }, function (person, cb) {
                        person.should.have.property("name", "John Doe");
                        person.should.have.property("gender", "female");
                        assertCount(Person, t, 0, 1, 1, cb);
                    }
                ], done);
            });
        });

        it("create using Person.create", function (done) {
            db.transaction(function (err, t) {
                if (err) {
                    return done(err);
                }
                async.waterfall([
                    function (cb) {
                        Person.create(getSamplePerson(), t, cb);
                    }, function (person, cb) {
                        person.should.have.property("name", "John Doe");
                        person.should.have.property("gender", "female");
                        assertCount(Person, t, 0, 1, 1, cb);
                    }
                ], done);
            });
        });

        // create personA
        // create personB
        // rollback personB
        // commit personA
        // one record should exist in db
        it("Create 2 Persons parallel", function (done) {
            async.parallel([
                function (cb) {
                    db.transaction(function (err, t) {
                        if (err) {
                            return cb(err);
                        }
                        async.waterfall([
                            function (cb) {
                                setTimeout(cb, 100);
                            }, function (cb) {
                                Person.create(getSamplePerson(), t, cb);
                            }, function (result, cb) {
                                setTimeout(cb, 300);
                            }, function (cb) {
                                assertCount(Person, t, 0, 1, 1, cb);
                            }
                        ], cb);
                    });
                },
                function (cb) {
                    db.transaction(function (err, t) {
                        if (err) {
                            return cb(err);
                        }
                        async.waterfall([
                            function (cb) {
                                setTimeout(cb, 100);
                            }, function (cb) {
                                Person.create(getSamplePerson(), t, cb);
                            }, function (result, cb) {
                                setTimeout(cb, 100);
                            }, function (cb) {
                                t.rollback(cb);
                            }
                        ], cb);
                    });
                }
            ], function (err) {
                should.equal(err, null);
                Person.count({}, function (err, count) {
                    should.equal(err, null);
                    count.should.equal(1);
                    done();
                });
            })
        });

        it("rollback", function (done) {
            db.transaction(function (err, t) {
                should.equal(err, null);
                async.waterfall([
                    function (cb) {
                        async.times(10, function (n, cb) {
                            Person.create(getSamplePerson(), t, cb);
                        }, cb);
                    }, function (result, cb) {
                        t.rollback(cb);
                    }, function (cb) {
                        Person.count(t, cb);
                    }, function (count) {
                        count.should.equal(0);
                        done();
                    }
                ], done)
            });
        });
    });


    //test cases with update
    describe("update Person", function () {
        var transaction, person;
        beforeEach(function (done) {
            async.waterfall([
                function (cb) {
                    Person.create({
                        id  : 1,
                        name: "John Doe",
                        gender: "male"
                    }, cb);
                }, function (result, cb) {
                    person = result;
                    db.transaction(cb);
                }, function (t, cb) {
                    transaction = t;
                    person.transaction = t;
                    cb();
                }
            ], done);
        });

        afterEach(releaseTransaction(function () {
            return transaction;
        }));

        it("should update and save person", function (done) {
            async.waterfall([
                function (cb) {
                    person.name = "edited";
                    person.save(cb);
                }, function (result, cb) {
                    transaction.commit(cb);
                }, function (cb) {
                    Person.one(cb)
                }, function (person2, cb) {
                    person2.name.should.equal("edited");
                    cb();
                }
            ], done)
        });
        it("should update, save person and rollback", function (done) {
            async.waterfall([
                function (cb) {
                    person.name = "edited";
                    person.save(cb);
                }, function (result, cb) {
                    Person.one(transaction, cb)
                }, function (person2, cb) {
                    person2.name.should.equal("edited");
                    transaction.rollback(cb);
                }, function (cb) {
                    Person.one(cb)
                }, function (person2, cb) {
                    person2.name.should.equal("John Doe");
                    cb();
                }
            ], done)
        });
    });

    //test model methods like Count, Clear, Find, Get
    describe("Model methods", function () {
        var transaction;
        beforeEach(function (done) {
            db.transaction(function (err, t) {
                if (err) {
                    return done(err);
                }
                transaction = t;
                //3 persons are created within transaction
                //1 person without transaction
                Person.create([{
                    id  : 1,
                    name: "John Doe 1",
                    gender: "female",
                    age: 15
                }, {
                    id  : 2,
                    name: "John Doe 2",
                    gender: "male",
                    age: 20
                }, {
                    id  : 3,
                    name: "John Doe 3",
                    gender: "male",
                    age: 13
                }], t, function (err) {
                    if (err) {
                        return done(err);
                    }
                    Person.create({
                        id  : 4,
                        name: "John Doe 4",
                        gender: "male",
                        age: 30
                    }, done);
                });
            });
        });

        afterEach(releaseTransaction(function () {
            return transaction;
        }));

        it("aggregate", function (done) {
            async.parallel([
                function (cb) {
                    Person.aggregate(transaction).count('id').min('id').max('id').get(function (err, count, min, max) {
                        should.equal(err, null);
                        count.should.equal(4);
                        min.should.equal(1);
                        max.should.equal(4);

                        transaction.commit(cb);
                    });
                },
                function (cb) {
                    Person.aggregate().count('id').min('id').max('id').get(function (err, count, min, max) {
                        should.equal(err, null);
                        count.should.equal(1);
                        min.should.equal(4);
                        max.should.equal(4);

                        cb();
                    });
                }
            ], done);
        });

        it("clear", function (done) {
            async.waterfall([
                function (cb) {
                    Person.clear(transaction, cb);
                }, function (cb) {
                    Person.find(transaction).count(cb);
                }, function (count, cb) {
                    count.should.equal(0);
                    transaction.commit(cb);
                }, function (cb) {
                    Person.count(cb);
                }, function (count, cb) {
                    count.should.equal(0);
                    cb();
                }
            ], done);
        });

        it("count", function (done) {
            async.parallel([
                function (cb) {
                    Person.count(transaction, function (err, count) {
                        should.equal(err, null);
                        count.should.equal(4);
                        cb();
                    });
                },
                function (cb) {
                    Person.count(function (err, count) {
                        should.equal(err, null);
                        count.should.equal(1);
                        cb();
                    });
                }
            ], done);
        });

        it("exists", function (done) {
            async.parallel([
                function (cb) {
                    Person.exists(1, transaction, function (err, exists) {
                        should.equal(err, null);
                        exists.should.be.true;
                        cb();
                    });
                },
                function (cb) {
                    Person.exists(1, function (err, exists) {
                        should.equal(err, null);
                        exists.should.be.false;
                        cb();
                    });
                }
            ], done);
        });

        it("find", function (done) {
            async.parallel([
                function (cb) {
                    Person.find({}, transaction, function (err, results) {
                        should.equal(err, null);
                        results.length.should.equal(4);
                        cb();
                    });
                },
                function (cb) {
                    Person.find({}, function (err, results) {
                        should.equal(err, null);
                        results.length.should.equal(1);
                        cb();
                    });
                }
            ], done);
        });

        it("find->remove (chain)", function (done) {
            Person.find({}, transaction).remove(function (err) {
                should.equal(err, null);
                assertCount(Person, transaction, 1, 0, 0, done);
            });
        });

        it("get", function (done) {
            async.parallel([
                function (cb) {
                    Person.get(1, transaction, function (err, person) {
                        should.equal(err, null);
                        person.should.be.ok;
                        cb();
                    });
                },
                function (cb) {
                    Person.get(1, function (err) {
                        // will return error if not found
                        err.should.be.ok;
                        cb();
                    });
                }
            ], done);
        });

        it("one", function (done) {
            async.parallel([
                function (cb) {
                    Person.one(transaction, function (err, person) {
                        should.equal(err, null);
                        person.id.should.equal(1);
                        cb();
                    });
                },
                function (cb) {
                    Person.one(function (err, person) {
                        should.equal(err, null);
                        person.id.should.equal(4);
                        cb();
                    });
                }
            ], done);
        });

        it("remove", function (done) {
            async.waterfall([
                function (cb) {
                    Person.one(transaction, cb);
                }, function (person, cb) {
                    person.id.should.equal(1);
                    person.remove(cb);
                }, function (result, cb) {
                    Person.one(transaction, cb);
                }, function (person, cb) {
                    person.id.should.equal(2);
                    cb();
                }
            ], done);
        });

        it("chain#1", function (done) {
            Person.find({ gender: "male" }, transaction).limit(1).offset(1).only("name").run(function (err, people) {
                should.equal(err, null);
                people.length.should.equal(1);
                people[0].name.should.equal('John Doe 3');
                done();
            });
        });
        it("chain#2", function (done) {
            Person.find({ gender: "male" }, transaction).where("LOWER(name) LIKE ?", ['%3%']).all(function (err, people) {
                should.equal(err, null);
                people.length.should.equal(1);
                people[0].name.should.equal('John Doe 3');
                done();
            });
        });
        it("chain#3", function (done) {
            Person.find({ gender: "male" }, transaction).where("LOWER(name) LIKE ?", ['%3%']).all(function (err, people) {
                should.equal(err, null);
                people.length.should.equal(1);
                people[0].name.should.equal('John Doe 3');
                done();
            });
        });
        it("chain#4", function (done) {
            Person.find({ gender: "male" }, transaction).each().filter(function (person) {
                return person.age >= 18;
            }).sort(function (person1, person2) {
                return person1.age < person2.age;
            }).get(function (people) {
                people.length.should.equal(2);
                people[0].name.should.equal('John Doe 4');
                people[0].age.should.equal(30);
                people[1].name.should.equal('John Doe 2');
                people[1].age.should.equal(20);
                done();
            });
        });
    });

    // Test all possible hooks
    // Transaction can be accessed by using 'this.transaction' in hook body
    describe("Hooks", function () {

        /**
         * Verify hook
         * @param name the hook name
         * @param done the callback function
         * @param [checkExists] true if check if person exists in transaction
         */
        function checkHook(name, done, checkExists) {
            async.parallel([
                // wait for hook
                function (cb) {
                    Person[name](function () {
                        this.transaction.should.be.ok;
                        if (checkExists) {
                            //get by id created person
                            //it should exist in transaction, but doesn't exist without transaction
                            var self = this;
                            async.waterfall([
                                function (cb) {
                                    Person.get(self.id, self.transaction, function (err, person) {
                                        should.equal(err, null);
                                        person.should.be.ok;
                                        cb();
                                    });
                                }, function (cb) {
                                    Person.get(self.id, function (err) {
                                        // will return error if not found
                                        err.should.be.ok;
                                        cb();
                                    });
                                }
                            ], cb);
                        } else {
                            cb();
                        }
                    });
                },
                // create and remove person
                function (cb) {
                    db.transaction(function (err, t) {
                        should.equal(err, null);
                        Person.create(getSamplePerson(), t, function (err, person) {
                            should.equal(err, null);
                            //add extra timeout, because we must wait for extra checkExists logic
                            setTimeout(function () {
                                person.remove(function (err) {
                                    should.equal(err, null);
                                    t.rollback(cb);
                                });
                            }, checkExists ? 200 : 0)
                        });
                    });
                }
            ], done)
        }

        it("beforeCreate", function (done) {
            checkHook("beforeCreate", done);
        });
        it("afterCreate", function (done) {
            checkHook("afterCreate", done);
        });
        it("afterSave", function (done) {
            checkHook("afterSave", done, true);
        });
        it("beforeSave", function (done) {
            checkHook("beforeSave", done);
        });
        it("beforeValidation", function (done) {
            checkHook("beforeValidation", done);
        });
        it("beforeRemove", function (done) {
            checkHook("beforeRemove", done);
        });
        it("afterRemove", function (done) {
            checkHook("afterRemove", done);
        });
        it("afterLoad", function (done) {
            checkHook("afterLoad", done);
        });
        it("afterAutoFetch", function (done) {
            checkHook("afterAutoFetch", done);
        });
    });

    // Test with associations between models (one to many, many to many etc)
    describe("Associations", function () {

        it("should create Person and Pet", function (done) {
            db.transaction(function (err, t) {
                if (err) {
                    return done(err);
                }
                async.waterfall([
                    function (cb) {
                        Person.create(getSamplePerson(), t, cb);
                    }, function (person, cb) {
                        person.addPets(new Pet({name: "cat"}), cb);
                    }, function (cat, cb) {
                        assertCount(Pet, t, 0, 1, 1, cb);
                    }
                ], done);
            });
        });

        it("should get all pets", function (done) {
            db.transaction(function (err, t) {
                if (err) {
                    return done(err);
                }
                var person;
                async.waterfall([
                    function (cb) {
                        Person.create(getSamplePerson(), t, cb);
                    }, function (result, cb) {
                        person = result;
                        async.forEach(["cat", "dog", "bird"], function (name, cb) {
                            person.addPets(new Pet({name: name}), cb);
                        }, cb);
                    }, function (cb) {
                        person.getPets(cb);
                    }, function (pets, cb) {
                        pets.length.should.be.equal(3);
                        Pet.find({}, cb);
                    }, function (pets, cb) {
                        //check pets without transaction
                        pets.length.should.be.equal(0);
                        t.rollback(cb);
                    }
                ], done);
            });
        });

        it("should find by favorite pet", function (done) {
            db.transaction(function (err, t) {
                if (err) {
                    return done(err);
                }
                async.waterfall([
                    function (cb) {
                        async.forEach(["cat", "dog", "bird"], function (name, cb) {
                            Person.create(getSamplePerson(), t, function (err, person) {
                                should.equal(err, null);
                                person.setFavPet(new Pet({name: name}), cb);
                            });
                        }, cb);
                    }, function (cb) {
                        Person.findByFavPet({name: "cat"}, t, cb);
                    }, function (pets, cb) {
                        pets.length.should.be.equal(1);
                        //check pets without transaction
                        Person.findByFavPet({name: "cat"}, cb);
                    }, function (pets, cb) {
                        pets.length.should.be.equal(0);
                        t.rollback(cb);
                    }
                ], done);
            });
        });

        it("should create and rollback Pet", function (done) {
            Person.create(getSamplePerson(), function (err, person) {
                if (err) {
                    return done(err);
                }
                db.transaction(function (err, t) {
                    if (err) {
                        return done(err);
                    }
                    person.transaction = t;
                    async.waterfall([
                        function (cb) {
                            person.addPets(new Pet({name: "cat"}), cb);
                        }, function (cat, cb) {
                            t.rollback(cb);
                        }, function (cb) {
                            person.getPets(cb);
                        }, function (pets, cb) {
                            pets.length.should.equal(0);
                            cb();
                        }
                    ], done);
                });
            });
        });

        it("should remove Pet from Person", function (done) {
            var person;
            async.waterfall([
                function (cb) {
                    Person.create(getSamplePerson(), cb);
                }, function (result, cb) {
                    person = result;
                    person.addPets(new Pet(), cb);
                }, function (cat, cb) {
                    db.transaction(function (err, t) {
                        if (err) {
                            return done(err);
                        }
                        //join person to transaction
                        person.transaction = t;
                        async.waterfall([
                            function (cb) {
                                person.removePets(cat, cb);
                            }, function (result, cb) {
                                //get person again but without transaction
                                Person.get(1, cb);
                            }, function (personNoTransaction, cb) {
                                personNoTransaction.getPets(cb);
                            }, function (pets, cb) {
                                pets.length.should.be.equal(1);
                                t.commit(cb);
                            }, function (cb) {
                                //get person again without transaction, but transaction is committed
                                Person.get(1, cb);
                            }, function (personNoTransaction, cb) {
                                personNoTransaction.getPets(cb);
                            }, function (pets, cb) {
                                pets.length.should.be.equal(0);
                                cb();
                            }
                        ], cb);
                    });
                }
            ], done);
        });

        it("should set favPet of Person", function (done) {
            var person;
            async.waterfall([
                function (cb) {
                    Person.create(getSamplePerson(), cb);
                }, function (result, cb) {
                    person = result;
                    db.transaction(function (err, t) {
                        if (err) {
                            return done(err);
                        }
                        //join person to transaction
                        person.transaction = t;
                        async.waterfall([
                            function (cb) {
                                person.setFavPet(new Pet(), cb);
                            }, function (result, cb) {
                                //get person again but without transaction
                                Person.get(1, cb);
                            }, function (personNoTransaction, cb) {
                                should.not.exist(personNoTransaction.favpet_id);
                                t.commit(cb);
                            }, function (cb) {
                                Person.get(1, cb);
                            }, function (personNoTransaction, cb) {
                                should.exist(personNoTransaction.favpet_id);
                                cb();
                            }
                        ], cb)
                    });
                }
            ], done);
        });

        it("should get favPet of Person", function (done) {
            db.transaction(function (err, t) {
                if (err) {
                    return done(err);
                }
                async.waterfall([
                    function (cb) {
                        Person.create(getSamplePerson(), cb);
                    }, function (person, cb) {
                        person.setFavPet(new Pet({name: 'cat'}), cb);
                    }, function (result, cb) {
                        //get person again
                        Person.get(1, t, cb);
                    }, function (person, cb) {
                        person.getFavPet(cb);
                    }, function (cat, cb) {
                        cat.name.should.equal('cat');
                        t.rollback(cb);
                    }
                ], done)
            });
        });
    });


    // Test raw sql queries with transaction
    describe("raw queries", function () {
        var transaction, sql;
        beforeEach(function (done) {
            sql = 'SELECT COUNT(*) AS "c" FROM "person"';
            db.transaction(function (err, t) {
                if (err) {
                    return done(err);
                }
                transaction = t;
                Person.create([{
                    id  : 1,
                    name: "John Doe 1",
                    gender: "male"
                }], t, done);
            });
        });

        afterEach(releaseTransaction(function () {
            return transaction;
        }));

        it("should run raw query with count", function (done) {
            async.parallel([
                function (cb) {
                    db.driver.execQuery(sql, transaction, function (err, result) {
                        should.equal(err, null);
                        result[0].c.should.equal(1);
                        cb();
                    })
                },
                function (cb) {
                    db.driver.execQuery(sql, function (err, result) {
                        should.equal(err, null);
                        result[0].c.should.equal(0);
                        cb();
                    })
                }
            ], done)
        });
    });
});


describe("transaction (single)", function () {
    if (common.protocol() !== 'postgres') return;

    var db = null;
    var Person = null;

    /**
     * Recreate Pet and Person tables
     * @returns {Function} the setup function
     */
    var setup = function () {
        return function (done) {
            Person = db.define("person", {
                name: String,
                gender: ['female', 'male'],
                age: Number
            }, {cache: false});

            return helper.dropSync([Person], done);
        };
    };

    before(function (done) {
        common.createConnection({}, function (err, connection) {
            if (err) {
                return done(err);
            }
            db = connection;
            return done();
        });
    });

    beforeEach(setup());

    it("should create Person", function (done) {
        db.transaction(function (err, t) {
            if (err) {
                return done(err);
            }
            async.waterfall([
                function (cb) {
                    Person.create(getSamplePerson(), t, cb);
                }, function (person, cb) {
                    person.should.have.property("name", "John Doe");
                    person.should.have.property("gender", "female");
                    t.commit(cb);
                }, function (cb) {
                    Person.get(1, cb);
                }
            ], done);
        });
    });

    it("should rollback Person", function (done) {
        db.transaction(function (err, t) {
            if (err) {
                return done(err);
            }
            async.waterfall([
                function (cb) {
                    Person.create(getSamplePerson(), t, cb);
                }, function (person, cb) {
                    t.rollback(cb);
                }, function (cb) {
                    Person.get(1, function (err) {
                        err.should.be.ok;
                        cb();
                    });
                }
            ], done);
        });
    });
});