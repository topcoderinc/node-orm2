ORM2 bug scripts
=========

This set of scripts allows you to check two bugs that are part of the ORM2-transaction plugin. Two scripts are provided

  - single.sh to reproduce the bug that share single connection with multiple requests
  - multiple.sh to reproduce this bug in connection pooling

Configuration
--------------

First, be sure that you have node foreman installed

```sh
sudo npm install -g nf
```

Then, edit the env_sample file, configuring the parameters to match your database settings.

Execution
--------------

Go to the folder where the files were extracted, and execute the target shell script

```sh
chmod a+x *.sh
. ./single.sh
. ./multi.sh
```

