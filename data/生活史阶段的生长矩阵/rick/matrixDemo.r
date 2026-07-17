## R data objects on matrix demography
load("matrixDemo.rdata")

## Raw data in a variable "raw" include a tag number, 2 dbh measurements and 2 dbh classes
# Species Protium stephensonii, BCI, 2010 and 2015
head(raw)
table(raw$class1)
table(raw$class2)

## The transition matrix of counts of trees is in variable "Nmat", is a table of both classes
table(raw$class1,raw$class2)
Nmat

## The transition matrix of probabilities converts the integers to rates per 5 years
Tmat

## Population size is stored as a vector of counts in each class
# Variable "startN" has 1000 saplings in class1 and no larger trees
startN

## The transition matrix projects the population forward one step (5 years) 
# Matrix multiplication %*% yields the population 5 years later
startN%*%Tmat

# Multiply twice to get the population after 10 years
startN%*%Tmat%*%Tmat

## This is the matrix squared. Note that R does NOT have powers of matrices
Tmat^2 # IS WRONG

## To get the population after 80 years would mean multiplying by the 16th power of the matrix. 
# To quickly get the 16th power
Tmat2=Tmat%*%Tmat
Tmat4=Tmat2%*%Tmat2
Tmat16=Tmat4%*%Tmat4

## Population after 80 years
startN%*%Tmat16

## There is also a transition matrix that includes all sizes from seed to adult, and a population starting with 1 million seeds. (The matrix FULLmat also has a fecundity term.)
FULLmat
startS

## Find the number of seeds that survive to adulthood after 80 years
startS%*%FULLmat


## Extra topic. Sampling error in the transition matrix. 
# Nmat is the matrix of integer counts for each size class.
# Each row is a multinomial probability distribution.
# R has a function for random draws on multinomial. Check row 1
k=1
Nmat[k,]
rmultinom(n=1,prob=Tmat[k,],size=sum(Nmat[k,])

## To get several samples from row 1, to estimate the sampling variance
t(rmultinom(n=4,prob=Tmat[k,],size=sum(Nmat[k,])))

## Repeat for row 4, with much lower sample size



